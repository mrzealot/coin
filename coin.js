const fs = require('fs')
const os = require('os')
const path = require('path')
const open = require('open')
const yaml = require('js-yaml')
const args = require('yargs').argv
const moment = require('moment')
const readline = require('readline')

let verbose = () => {}





class Transaction {
    constructor(mark, date, from, to, comment, context) {
        this.mark = mark
        this.date = date
        this.from = from
        this.to = to
        this.comment = comment
        this.context = context
    }

    stringify() {
        const m = this.mark ? `[${this.mark}] ` : ''
        const d = this.date.format(this.context.format)
        return `${m}`
    }
}




class Parser {

    constructor(config, args) {
        this.config = config
        this.args = args
        this.context = {}
        this.lineno = 0
        this.defaults = {
            format: 'YY-MM-DD',
            currency: 'HUF',
            categories: [],
            accounts: []
        }
    }

    amount(n) {
        try {
            return parseFloat((n+'').replace(',', ''))
        } catch (ex) {
            throw new Error(`Invalid amount ${n} on line ${this.lineno} (${ex})`)
        }
    }

    date(d) {
        let result = ''
        let now = moment()
    
        const relative_dates = {
            yyy: -3,
            yy: -2,
            y: -1,
            n: 0, // as in now
            t: 0 // as in today
        }
    
        // relative date
        if (Object.keys(relative_dates).includes(d)) {
            result = moment().add(relative_dates[d], 'days')
    
        // single number means day of month
        } else if (d.match(/^\d+$/)) {
            const num = parseInt(d)
            // if it would be in the future, then it must mean last month
            if (now.date() < num) {
                const then = moment().subtract(1, 'month')
                result = moment([then.year(), then.month(), num])
            } else {
                result = moment([now.year(), now.month(), num])
            }
            
        // double number, should be this year
        } else if (d.match(/^\d+[.-_/]\d+$/)) {
            const [month, day]= d.split(/[.-_/]/)
            result = moment([now.year(), parseInt(month), parseInt(day)])
    
        // otherwise should parse on its own
        } else {
            result = moment(d, this.context.format)
        }
    
        // let's see what we came up with
        if (!result.isValid()) {
            throw new Error(`Invalid date "${d}" on line ${this.lineno}...`)
        }
    
        return result
    }

    account(acc) {
        const result = this.context.accounts[acc]
        if (!result) {
            throw new Error(`Unknown account ${acc} on line ${this.lineno}`)
        }
        return result
    }

    funds(fund) {
        let acc, amt
        try {
            [acc, amt] = fund.split(':')
        } catch (ex) {
            throw new Error(`Invalid fund ${fund} on line ${this.lineno}`)
        }
        return {
            account: this.account(acc),
            amount: this.amount(amt)
        }
    }

    category(cat) {
        let main, sub
        try {
            [main, sub] = cat.split('/')
        } catch (ex) {
            throw new Error(`Invalid category ${cat} on line ${this.lineno}`)
        }
        main = this.context.categories[main]
        sub = main && main.subs && main.subs[sub]
        if (!main || !sub) {
            throw new Error(`Unknown category ${cat} on line ${this.lineno}`)
        }
        return {main, sub}
    }

    line(line) {

        line = line.trim()
    
        // empty lines and comments are skipped
        if (!line.length || line.startsWith('#')) {
            return
        }
    
        verbose(`Parsing line "${line}"`)
    
        const parts = line.split(/\s+/g)
    
        // optional starting mark, enclosed in brackets
        let mark = ''
        if (parts[0].startsWith('[')) {
            mark = parts[0].replace('[', '').replace(']', '')
            parts.shift()
        }
    
        let [date, from, to, ...comment] = parts

        // date
        date = this.date(date)
    
        // to/from untangling
        if (from.includes(':')) {
            from = this.funds(from)
            if (to.includes(':')) {
                // transfer
                to = this.funds(to)
            } else {
                // outgoing
                to = this.category(to)
            }
        } else {
            // incoming
            from = this.category(from)
            to = this.funds(to)
        }

        // clean up comment
        comment = comment.join(' ').trim()
        
        return new Transaction(mark, date, from, to, comment, this.context)
    }

    name(str) {
        const [id, ...display_arr] = str.split(/\s+/g)
        const display =
            display_arr.join(' ').trim().slice(1, -1) // explicit display name, with stripped parens
            || (id.charAt(0).toUpperCase() + id.slice(1)) // implicit display name, capitalized
        return {id, display}
    }

    header(h) {
        const cats = {}
        for (const cat of h.categories) {
            const name = this.name(cat.name)
            const subs = {}
            for (const sub of cat.subs) {
                const sub_name = this.name(sub)
                subs[sub_name.id] = sub_name
            }
            cats[name.id] = {name, subs}
        }
        h.categories = cats
        
        const accs = {}
        for (const acc of h.accounts) {
            const name = this.name(acc.name)
            const currency = acc.currency || this.context.currency
            const group = acc.group
            const init = acc.init || 0
            accs[name.id] = {name, currency, group, init}
        }
        h.accounts = accs
        return h
    }

    combine(...sources) {
        const res = {}
        for (const source of sources) {
            for (const [key, value] of Object.entries(source)) {
                res[key] = value
            }
        }
        return res
    }

    async parse(input) {
        this.lineno = 0
        let transactions = []
        let in_yaml = false
        let header_str = ''
        const rl = readline.createInterface({
            input: fs.createReadStream(input)
        })
        
        for await (const line of rl) {
            this.lineno++
    
            if (line.trim() == '---') {
                in_yaml = !in_yaml
                if (!in_yaml) {
                    const header = this.header(yaml.safeLoad(header_str))
                    this.context = this.combine(this.defaults, this.config, header, this.args)
                    this.context.raw_header = header_str
                }
                continue
            }
    
            if (in_yaml) {
                header_str += line + '\n'
            } else {
                const transaction = this.line(line)
                if (transaction) {
                    transactions.push(transaction)
                }
            }
        }
    
        const result = this.context
        result.transactions = transactions
        return result
    }
}







class Commander {

    constructor(data) {
        this.data = data
        this.aliases = {
            u: 'usage',
            c: 'config',
            r: 'resolve',
            d: 'dump',
            v: 'view'
        }
    }

    usage(msg = '', code = 1) {
        if (msg) {
            console.log(msg)
            console.log()
        }
        console.log(`Common arguments:`)
        console.log(`  -c/--config: specify the config file to use`)
        console.log(`  -i/--input: specify/override the input file`)
        console.log()
        console.log(`Commands:`)
        console.log(`coin (c)onfig -- list all current config key/value pairs`)
        console.log(`coin (c)onfig key -- print config for a specific key`)
        console.log(`coin (c)onfig key value -- set key to value in the config`)
        console.log()
        console.log(`coin (r)esolve -- bring to canonical/sorted form and update database`)
        console.log()
        console.log(`coin (d)ump filename -- dump the internal representation`)
        console.log()
        console.log(`coin (v)iew -- dump and open an html based view`)
        process.exit(code)
    }

    config() {

    }
    
    resolve() {

    }
    
    dump() {

    }

    view() {
    
        //open('test.html')
    }
}













;(async () => {

    // logging (if necessary)
    if (args.v || args.verbose) {
        verbose = console.log.bind(console)
    }

    // set up config
    if (!args.config) {
        args.config = path.join(os.homedir(), '.coin_config')
    }
    if (!fs.existsSync(args.config)) {
        verbose(`Initializing config file at ${args.config}`)
        fs.writeFileSync(args.config, yaml.safeDump({}))
    }
    verbose(`Loading config from ${args.config}`)
    const config = yaml.safeLoad(fs.readFileSync(args.config, 'utf8'))

    // parse input
    let input = ''
    if (config.input) {
        input = config.input
    } else if (args.input || args.i) {
        input = args.input || args.i
    } else {
        usage('Missing input...')
        process.exit(1)
    }
    verbose(`Parsing input ${input}`)
    const parser = new Parser(config, args)
    const data = await parser.parse(input)

    // execute command
    const commander = new Commander(data)
    let command = args._[0]
    command = commander.aliases[command] || command
    if (!command) commander.usage(`Missing command...`)
    if (!commander[command]) commander.usage(`Unknown command "${command}"`)
    verbose(`Executing command ${command}`)
    commander[command]()

})()