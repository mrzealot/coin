const fs = require('fs')
const os = require('os')
const path = require('path')
const open = require('open')
const yaml = require('js-yaml')
const args = require('yargs').argv
const moment = require('moment')
const readline = require('readline')


function parse_amount(num, lineno, context) {
    try {
        return parseFloat((num+'').replace(',', ''))
    } catch (ex) {
        throw new Error(`Invalid number ${num} on line ${lineno} (${ex})`)
    }
}

function parse_date(date, lineno, context) {

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
    if (Object.keys(relative_dates).includes(date)) {
        result = moment().add(relative_dates[date], 'days')

    // single number means day of month
    } else if (date.match(/^\d+$/)) {
        const num = parseInt(date)
        // if it would be in the future, then it must mean last month
        if (now.date() < num) {
            const then = moment().subtract(1, 'month')
            result = moment([then.year(), then.month(), num])
        } else {
            result = moment([now.year(), now.month(), num])
        }
        
    // double number, should be this year
    } else if (date.match(/^\d+[.-_/]\d+$/)) {
        const [m, d]= date.split(/[.-_/]/)
        result = moment([now.year(), parseInt(m), parseInt(d)])

    // otherwise should parse on its own
    } else {
        const default_format =
            context.frontmatter.default_date_format ||
            context.config.default_date_format ||
            'YY-MM-DD'
        result = moment(date, default_format)
    }

    // let's see what we came up with
    if (!result.isValid()) {
        throw new Error(`Invalid date "${date}" on line ${lineno}...`)
    }

    return result
}

function parse_account(acc, lineno, context) {
    const result = context.frontmatter.accounts[acc]
    if (!result) {
        throw new Error(`Unknown account ${acc} on line ${lineno}`)
    }
    return result
}

function parse_funds(fund, lineno, context) {
    const [acc, amt] = fund.split(':')
    return {
        account: parse_account(acc),
        amount: parse_amount(amt)
    }
}

function parse_category(cat, lineno, context) {
    let [main, sub] = cat.split('/')
    main = context.frontmatter.categories[main]
}

function parse_line(line, lineno, context) {

    line = line.trim()

    // empty lines and comments are skipped
    if (!line.length || line.startsWith('#')) {
        return
    }

    console.log('line:', line)

    const parts = line.split(/\s+/g)

    // optional starting mark, enclosed in brackets
    let marked = ''
    if (parts[0].startsWith('[')) {
        marked = parts[0].replace('[', '').replace(']', '')
        parts.shift()
    }

    // date
    const date = parse_date(parts.shift(), lineno, context)

    // to/from untangling
    if (parts[0].includes(':')) {
        if (parts[2].includes(':')) {
            // transfer
        } else {
            // outgoing
        }
    } else {
        // incoming
    }
    

}

async function parse_input(input, context) {
    let lineno = 0
    let transactions = []
    let in_yaml = false
    let frontmatter_str = ''
    let raw_frontmatter = {}
    const rl = readline.createInterface({
        input: fs.createReadStream(input)
    })
    
    for await (const line of rl) {
        lineno++

        if (line.trim() == '---') {
            in_yaml = !in_yaml
            if (!in_yaml) {
                raw_frontmatter = yaml.safeLoad(frontmatter_str)
                context.frontmatter = prep_frontmatter(yaml.safeLoad(frontmatter_str))
                context.frontmatter.raw = frontmatter_str
            }
            continue
        }

        if (in_yaml) {
            frontmatter_str += line + '\n'
        } else {
            const parsed_line = parse_line(line, lineno, context)
            if (parsed_line) {
                transactions.push(parsed_line)
            }
        }
    }

    const result = context.frontmatter
    result.transactions = transactions
    return result
}

function usage(msg = '') {
    if (msg) {
        console.log(msg)
        console.log()
    }
    console.log(`Common argument:`)
    console.log(`  -c/--config: specify the config file to use`)
    console.log(`  -i/--input: specify/override the input file`)
    console.log()
    console.log(`Commands:`)
    console.log(`coin (c)onfig -- list all current config key/value pairs`)
    console.log(`coin (c)onfig key -- print config for a specific key`)
    console.log(`coin (c)onfig key value -- set key to value in the config`)
    console.log()
    console.log(`coin (v)alidate -- bring to canonical sorted form and check`)
    console.log()
    console.log(`coin (q)uery`)
    console.log()
    console.log(`coin (r)eport -- dump and open a html based report`)
}

function c_config() {

}

function c_validate() {

}

function c_query() {

}

function c_report() {

    //open('test.html')
}




async function main() {


    // date testing

    console.log(parse_date('y', 0).format('YY-MM-DD'))





    // set up config
    if (!args.config) {
        args.config = path.join(os.homedir(), '.coin_config')
    }
    if (!fs.existsSync(args.config)) {
        console.log(`Initializing config file at ${args.config}`)
        fs.writeFileSync(args.config, yaml.safeDump({}))
    }
    const config = yaml.safeLoad(fs.readFileSync(args.config, 'utf8'))
    const context = {args, config}

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
    const data = await parse_input(input, context)


    console.log(data)
    throw 2

    // execute command
    switch (args._[0]) {
        case 'c':
        case 'config':
            c_config()
            break
        case 'v':
        case 'validate':
            c_validate()
            break
        case 'q':
        case 'query':
            c_query()
            break
        case 'r':
        case 'report':
            c_report()
            break
        case undefined:
            usage(`Missing command...`)
            process.exit(2)
        default:
            usage(`Unknown command "${args._[0]}"`)
            process.exit(3)
    }
}

main()