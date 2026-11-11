const app = require( "express" )();
const bodyParser = require( "body-parser" );
// the same module instance server.js mounts (each .db file is opened once)
const Journal = require( "./journal" );

app.use( bodyParser.json() );

module.exports = app;

// ---- Accounts ---------------------------------------------------------------
// Every money event the Quick Journal knows about (sales, credit and advance
// payments, refunds, GRNs, PRNs, supplier payments, expenses, stock
// adjustments, money transfers) posted to the accounts it touches. Read only:
// nothing is stored here, the accounts are worked out from the records.
//
// Balance accounts carry a balance from one day to the next:
//   Cash, Card, Bank Transfer (and any other method used) - money held
//   Customer Credit - owed to the shop by customers (credit sales - payments)
//   Customer Advances - paid in advance by customers, not used yet
//   Supplier Credit - owed by the shop to suppliers (credit GRNs - payments)
//   Supplier Advances - paid to suppliers ahead, not used by GRNs yet
// Activity accounts add up what happened in the period: Sales, Returns &
// Exchanges, GRN Purchases, Purchase Returns, Expenses, Stock Written Off,
// Stock Added, Money Transfers.
//
// GET /?from=YYYY-MM-DD&to=YYYY-MM-DD        every account: opening, in, out, closing
// GET /ledger?account=cash&from=...&to=...  one account's entries with a running balance
// from is optional (all records); to defaults to today.

const ACCOUNTS = [
    { id: "cash", name: "Cash", group: "Money", type: "balance", icon: "fa-money", note: "money in the till / in hand" },
    { id: "card", name: "Card", group: "Money", type: "balance", icon: "fa-credit-card", note: "card payments, until moved to the bank" },
    { id: "bank", name: "Bank Transfer", group: "Money", type: "balance", icon: "fa-university", note: "money in the bank" },
    { id: "transfers", name: "Money Transfers", group: "Money", type: "activity", icon: "fa-exchange", note: "money moved between methods" },
    { id: "receivable", name: "Customer Credit", group: "Customers", type: "balance", icon: "fa-user", note: "owed to you by customers" },
    { id: "customer_advance", name: "Customer Advances", group: "Customers", type: "balance", icon: "fa-user-plus", note: "paid in advance by customers, not used yet" },
    { id: "payable", name: "Supplier Credit", group: "Suppliers", type: "balance", icon: "fa-truck", note: "owed by you to suppliers" },
    { id: "supplier_advance", name: "Supplier Advances", group: "Suppliers", type: "balance", icon: "fa-forward", note: "paid to suppliers ahead, not used by GRNs yet" },
    { id: "sales", name: "Sales", group: "Sales & Purchases", type: "activity", icon: "fa-shopping-cart", note: "bills, incl. credit sales" },
    { id: "returns", name: "Returns & Exchanges", group: "Sales & Purchases", type: "activity", icon: "fa-undo", note: "goods brought back by customers" },
    { id: "grn", name: "GRN Purchases", group: "Sales & Purchases", type: "activity", icon: "fa-truck", note: "goods received from suppliers" },
    { id: "prn", name: "Purchase Returns (PRN)", group: "Sales & Purchases", type: "activity", icon: "fa-reply", note: "goods sent back to suppliers" },
    { id: "expenses", name: "Expenses", group: "Sales & Purchases", type: "activity", icon: "fa-file-text-o", note: "rent, bills, salaries..." },
    { id: "stock_out", name: "Stock Written Off", group: "Stock", type: "activity", icon: "fa-arrow-down", note: "expired, damaged, lost (at cost)" },
    { id: "stock_in", name: "Stock Added", group: "Stock", type: "activity", icon: "fa-arrow-up", note: "found in stock counts (at cost)" }
];
const METHOD_IDS = { Cash: "cash", Card: "card", "Bank Transfer": "bank" };

function round2( n ) {
    return Math.round( ( Number( n ) || 0 ) * 100 ) / 100;
}

function methodAccount( name ) {
    return METHOD_IDS[name] || "method:" + ( name || "Other" );
}

// an account for a payment method the list doesn't have (e.g. an old "Other")
function accountInfo( id ) {
    let a = ACCOUNTS.find( ( x ) => x.id === id );
    if ( a ) return a;
    if ( id.indexOf( "method:" ) === 0 ) {
        return { id: id, name: id.slice( 7 ), group: "Money", type: "balance", icon: "fa-money", note: "other payment method" };
    }
    return null;
}

// The postings of one journal entry: [{ account, in, out }] (in raises the
// account, out lowers it), plus what is needed to show the entry.
function postingsOf( e ) {
    let out = [];
    let base = {
        at: e.at,
        time_known: e.time_known,
        kind: e.kind,
        type: e.type,
        id: e.id,
        sale_id: e.sale_id,
        order_id: e.order_id,
        supplier_id: e.supplier_id,
        receipt: e.receipt, // credit payment receipt
        reference: e.reference || "",
        party: e.party || "",
        details: e.details || "",
        method: e.method || "",
        user: e.user || ""
    };
    let add = ( account, inAmount, outAmount ) => {
        inAmount = round2( inAmount );
        outAmount = round2( outAmount );
        if ( inAmount || outAmount ) out.push( Object.assign( {}, base, { account: account, in: inAmount, out: outAmount } ) );
    };
    let amount = Number( e.amount ) || 0;
    // money in / out by method
    if ( e.money_in > 0 ) add( methodAccount( e.in_method ), e.money_in, 0 );
    if ( e.money_out > 0 ) add( methodAccount( e.out_method ), 0, e.money_out );

    switch ( e.kind ) {
        case "sale":
            add( "sales", amount, 0 );
            // the part put on credit: owed by the customer (as on the Customers
            // page, credit without a customer isn't owed by anyone)
            if ( e.customer_id != null ) add( "receivable", e.on_credit, 0 );
            add( "customer_advance", 0, e.advance_used ); // paid from the customer's advance
            break;
        case "customer_credit_payment":
            add( "receivable", 0, amount );
            break;
        case "customer_advance":
            add( "customer_advance", amount, 0 );
            break;
        case "return":
        case "exchange":
            add( "returns", amount, 0 );
            break;
        case "expense":
            add( "expenses", amount, 0 );
            break;
        case "grn":
            add( "grn", amount, 0 );
            add( "payable", e.on_credit, 0 );
            add( "supplier_advance", 0, e.advance_used );
            break;
        case "supplier_credit_payment":
            add( "payable", 0, amount );
            break;
        case "supplier_advance":
            add( "supplier_advance", amount, 0 );
            break;
        case "prn": {
            add( "prn", amount, 0 );
            // deducted from the supplier's balance: clears what is owed first,
            // the rest becomes the supplier's advance
            if ( !( e.money_in > 0 ) && /^Deducted/.test( e.method || "" ) ) {
                let owed = e.position_before == null ? amount : Math.max( Number( e.position_before ) || 0, 0 );
                let applied = Math.min( amount, owed );
                add( "payable", 0, applied );
                add( "supplier_advance", amount - applied, 0 );
            }
            break;
        }
        case "adjustment":
            add( e.type === "Stock Added" ? "stock_in" : "stock_out", amount, 0 );
            break;
        case "transfer":
            add( methodAccount( e.transfer_from ), 0, amount );
            add( methodAccount( e.transfer_to ), amount, 0 );
            add( "transfers", amount, 0 );
            break;
    }
    return out;
}

// The customer, supplier or expense type an entry belongs to:
// { by: "customer" | "supplier" | "expense", key, name } or null.
// saleCustomers: sale id -> the sale's customer (a return only knows its bill).
function customerParty( id, name ) {
    return id != null
        ? { by: "customer", key: String( id ), name: name || "Customer" }
        : { by: "customer", key: "walkin", name: "Walk-in customers" };
}

function partyOf( e, saleCustomers ) {
    switch ( e.kind ) {
        case "sale":
        case "customer_advance":
        case "customer_credit_payment":
            return customerParty( e.customer_id, e.party );
        case "return":
        case "exchange": {
            let s = saleCustomers[e.order_id];
            return s ? customerParty( s.customer_id, s.party ) : customerParty( null );
        }
        case "grn":
        case "prn":
        case "supplier_credit_payment":
        case "supplier_advance":
            return e.supplier_id
                ? { by: "supplier", key: String( e.supplier_id ), name: e.party || "Supplier" }
                : { by: "supplier", key: "walkin", name: "Walk-in sellers" };
        case "expense":
            return {
                by: "expense",
                key: e.expense_type_id != null ? String( e.expense_type_id ) : "none",
                name: e.reference || "No type"
            };
    }
    return null;
}

// Every entry up to the end of toDay, oldest first, with its postings
// (e.postings) and who it belongs to (e.party_of).
// callback(err, entries, range)
function entriesUpTo( query, callback ) {
    let fromDay = query.from ? Journal.parseDay( query.from ) : null;
    let toDay = query.to ? Journal.parseDay( query.to ) : new Date();
    if ( ( query.from && !fromDay ) || !toDay ) return callback( { status: 400, message: "Please choose a valid date." } );
    if ( fromDay && toDay < fromDay ) return callback( { status: 400, message: "The end date is before the start date." } );
    Journal.loadEntries( new Date( 2000, 0, 1 ), toDay, function ( err, entries ) {
        if ( err ) return callback( { status: 500, message: err.message } );
        // records kept by date only (a transfer, a GRN entered on a later
        // day) come after that day's timed entries, e.g. the day's takings
        // first, then the cash banked at the end of the day
        let sortKey = ( e ) => {
            let d = new Date( e.at );
            if ( !e.time_known ) d = new Date( d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999 );
            return d.getTime();
        };
        entries = entries
            .map( ( e, i ) => ( { e: e, i: i, k: sortKey( e ) } ) )
            .sort( ( a, b ) => a.k - b.k || a.i - b.i )
            .map( ( x ) => x.e );
        let saleCustomers = {};
        entries.forEach( ( e ) => {
            if ( e.kind === "sale" ) saleCustomers[e.id] = { customer_id: e.customer_id, party: e.party };
        } );
        entries.forEach( ( e ) => {
            e.postings = postingsOf( e );
            e.party_of = partyOf( e, saleCustomers );
        } );
        let start = fromDay ? new Date( fromDay.getFullYear(), fromDay.getMonth(), fromDay.getDate() ) : null;
        callback( null, entries, {
            from: fromDay ? Journal.dayText( fromDay ) : "",
            to: Journal.dayText( toDay ),
            before: ( x ) => !!start && new Date( x.at ) < start
        } );
    } );
}

// all postings up to the end of toDay, oldest first. callback(err, postings, range)
function postingsUpTo( query, callback ) {
    entriesUpTo( query, function ( err, entries, range ) {
        if ( err ) return callback( err );
        let postings = [];
        entries.forEach( ( e ) => postings.push.apply( postings, e.postings ) );
        callback( null, postings, range );
    } );
}

function accountIds( postings ) {
    let ids = ACCOUNTS.map( ( a ) => a.id );
    postings.forEach( ( p ) => {
        if ( !ids.includes( p.account ) ) ids.splice( 3, 0, p.account ); // other methods after Bank Transfer
    } );
    return ids;
}

app.get( "/", function ( req, res ) {
    postingsUpTo( req.query, function ( err, postings, range ) {
        if ( err ) return res.status( err.status ).send( err.message );
        let totals = {};
        accountIds( postings ).forEach( ( id ) => ( totals[id] = { opening: 0, in: 0, out: 0, count: 0 } ) );
        postings.forEach( ( p ) => {
            let t = totals[p.account];
            let info = accountInfo( p.account );
            if ( range.before( p ) ) {
                // what happened before the period: only balances carry over
                if ( info.type === "balance" ) t.opening += p.in - p.out;
                return;
            }
            t.in += p.in;
            t.out += p.out;
            t.count++;
        } );
        let accounts = Object.keys( totals ).map( ( id ) => {
            let t = totals[id];
            let info = accountInfo( id );
            return Object.assign( {}, info, {
                opening: round2( t.opening ),
                in: round2( t.in ),
                out: round2( t.out ),
                count: t.count,
                closing: round2( t.opening + t.in - t.out )
            } );
        } );
        res.send( { from: range.from, to: range.to, accounts: accounts } );
    } );
} );

app.get( "/ledger", function ( req, res ) {
    let id = String( req.query.account || "" );
    let info = accountInfo( id );
    if ( !info ) return res.status( 400 ).send( "That account doesn't exist." );
    postingsUpTo( req.query, function ( err, postings, range ) {
        if ( err ) return res.status( err.status ).send( err.message );
        let opening = 0;
        let rows = [];
        postings.forEach( ( p ) => {
            if ( p.account !== id ) return;
            if ( range.before( p ) ) {
                if ( info.type === "balance" ) opening += p.in - p.out;
                return;
            }
            rows.push( p );
        } );
        opening = round2( opening );
        let balance = opening;
        rows.forEach( ( p ) => {
            balance = round2( balance + p.in - p.out );
            p.balance = balance;
        } );
        res.send( {
            from: range.from,
            to: range.to,
            account: info,
            opening: opening,
            in: round2( rows.reduce( ( s, p ) => s + p.in, 0 ) ),
            out: round2( rows.reduce( ( s, p ) => s + p.out, 0 ) ),
            closing: balance,
            rows: rows
        } );
    } );
} );

// ---- Customer-wise, supplier-wise, expense-wise ------------------------------
// GET /parties?by=customer|supplier|expense&from&to   one row per customer /
//     supplier / expense type: the period's totals and the balance at the end
// GET /party?by=...&key=...&from&to                   one of them: its entries
//     with a running balance (customers / suppliers: owed minus advance held;
//     expenses: running total)
// Walk-in customers (sales without a customer) and walk-in sellers are a row
// of their own, so the rows add up to the accounts.
const PARTY_BY = {
    customer: { owes: "receivable", advance: "customer_advance", label: "customers" },
    supplier: { owes: "payable", advance: "supplier_advance", label: "suppliers" },
    expense: { label: "expense types" }
};

function isMoneyAccount( id ) {
    return id === "cash" || id === "card" || id === "bank" || id.indexOf( "method:" ) === 0;
}

// what one entry does for its customer / supplier: money in and out of the
// shop, and the change in what is owed and in the advance held
function entryEffect( e, by ) {
    let accounts = PARTY_BY[by];
    let eff = { money_in: 0, money_out: 0, owes: 0, advance: 0 };
    e.postings.forEach( ( p ) => {
        if ( isMoneyAccount( p.account ) ) {
            eff.money_in += p.in;
            eff.money_out += p.out;
        }
        if ( p.account === accounts.owes ) eff.owes += p.in - p.out;
        if ( p.account === accounts.advance ) eff.advance += p.in - p.out;
    } );
    Object.keys( eff ).forEach( ( k ) => ( eff[k] = round2( eff[k] ) ) );
    return eff;
}

function newFigures( party ) {
    return {
        key: party.key,
        name: party.name,
        walk_in: party.key === "walkin",
        count: 0, // entries in the period
        money_in: 0,
        money_out: 0,
        opening_owes: 0,
        opening_advance: 0,
        owes: 0, // at the end of the period
        advance: 0,
        bills: 0, // customers: sales
        sales: 0,
        grns: 0, // suppliers: GRNs
        purchases: 0,
        returns: 0, // returns & exchanges / purchase returns
        total: 0, // expenses
        methods: {}, // expenses: paid by
        last_at: null
    };
}

// add one entry to a party's figures (before: it happened before the period)
function addToFigures( f, e, eff, before ) {
    f.owes += eff.owes;
    f.advance += eff.advance;
    f.name = e.party_of.name; // the latest name
    if ( before ) {
        f.opening_owes += eff.owes;
        f.opening_advance += eff.advance;
        return;
    }
    let amount = Number( e.amount ) || 0;
    f.count++;
    f.money_in += eff.money_in;
    f.money_out += eff.money_out;
    f.last_at = e.at;
    if ( e.kind === "sale" ) {
        f.bills++;
        f.sales += amount;
    } else if ( e.kind === "grn" ) {
        f.grns++;
        f.purchases += amount;
    } else if ( e.kind === "return" || e.kind === "exchange" || e.kind === "prn" ) {
        f.returns += amount;
    } else if ( e.kind === "expense" ) {
        f.total += amount;
        let m = e.method || "Other";
        f.methods[m] = ( f.methods[m] || 0 ) + amount;
    }
}

function roundFigures( f ) {
    [ "money_in", "money_out", "opening_owes", "opening_advance", "owes", "advance", "sales", "purchases", "returns", "total" ].forEach(
        ( k ) => ( f[k] = round2( f[k] ) )
    );
    Object.keys( f.methods ).forEach( ( m ) => ( f.methods[m] = round2( f.methods[m] ) ) );
    f.balance = round2( f.owes - f.advance ); // owed, less the advance held
    f.opening_balance = round2( f.opening_owes - f.opening_advance );
    return f;
}

function partyBy( req, res ) {
    let by = String( req.query.by || "" );
    if ( !PARTY_BY[by] ) {
        res.status( 400 ).send( "Choose customers, suppliers or expenses." );
        return null;
    }
    return by;
}

app.get( "/parties", function ( req, res ) {
    let by = partyBy( req, res );
    if ( !by ) return;
    entriesUpTo( req.query, function ( err, entries, range ) {
        if ( err ) return res.status( err.status ).send( err.message );
        let figures = {};
        entries.forEach( ( e ) => {
            if ( !e.party_of || e.party_of.by !== by ) return;
            let key = e.party_of.key;
            if ( !figures[key] ) figures[key] = newFigures( e.party_of );
            addToFigures( figures[key], e, by === "expense" ? {} : entryEffect( e, by ), range.before( e ) );
        } );
        // the ones with something in the period or a balance left
        let parties = Object.keys( figures )
            .map( ( k ) => roundFigures( figures[k] ) )
            .filter( ( f ) => f.count || f.owes || f.advance );
        let totals = roundFigures( newFigures( { key: "", name: "Total" } ) );
        [ "count", "money_in", "money_out", "opening_owes", "opening_advance", "owes", "advance", "bills", "sales", "grns", "purchases", "returns", "total" ].forEach(
            ( k ) => ( totals[k] = round2( parties.reduce( ( s, f ) => s + ( f[k] || 0 ), 0 ) ) )
        );
        totals.balance = round2( totals.owes - totals.advance );
        res.send( { by: by, from: range.from, to: range.to, parties: parties, totals: totals } );
    } );
} );

app.get( "/party", function ( req, res ) {
    let by = partyBy( req, res );
    if ( !by ) return;
    let key = String( req.query.key || "" );
    entriesUpTo( req.query, function ( err, entries, range ) {
        if ( err ) return res.status( err.status ).send( err.message );
        let f = null;
        let rows = [];
        let owes = 0;
        let advance = 0;
        let runningTotal = 0;
        entries.forEach( ( e ) => {
            if ( !e.party_of || e.party_of.by !== by || e.party_of.key !== key ) return;
            if ( !f ) f = newFigures( e.party_of );
            let eff = by === "expense" ? {} : entryEffect( e, by );
            let before = range.before( e );
            addToFigures( f, e, eff, before );
            if ( before ) return;
            let row = Object.assign( {}, e, eff );
            delete row.postings;
            delete row.party_of;
            if ( by === "expense" ) {
                runningTotal = round2( runningTotal + ( Number( e.amount ) || 0 ) );
                row.balance = runningTotal;
            } else {
                owes = round2( f.owes );
                advance = round2( f.advance );
                row.owes_after = owes;
                row.advance_after = advance;
                row.balance = round2( owes - advance );
            }
            rows.push( row );
        } );
        if ( !f ) return res.status( 404 ).send( "Nothing found for this " + PARTY_BY[by].label.replace( /s$/, "" ) + "." );
        res.send( { by: by, from: range.from, to: range.to, party: roundFigures( f ), rows: rows } );
    } );
} );
