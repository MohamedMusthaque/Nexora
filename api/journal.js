const app = require( "express" )();
const bodyParser = require( "body-parser" );
// the same module instances server.js mounts (each .db file is opened once)
const Transactions = require( "./transactions" );
const Expenses = require( "./expenses" );
const Suppliers = require( "./suppliers" );
const Adjustments = require( "./adjustments" );
const Transfers = require( "./transfers" );

app.use( bodyParser.json() );

module.exports = app;

// ---- Quick Journal ----
// Everything that happened on a day (or a range of days), in one list:
//   sales (incl. credit sales), returns & exchanges, credit payments (customers
//   settling credit, settling suppliers' credit), advance payments (customers
//   paying in advance, paying suppliers in advance), expenses and GRNs
// A payment that is partly credit and partly advance shows as two entries.
// Each entry says how much money came in or went out and by which method, so
// the day's cash, card and bank transfer totals can be checked. Amounts put on
// credit (customer or supplier) and advances used move no money that day.
//
// GET /?from=YYYY-MM-DD&to=YYYY-MM-DD  (to defaults to from)
// -> { from, to, entries: [...], summary: {...} }

function round2( n ) {
    return Math.round( ( Number( n ) || 0 ) * 100 ) / 100;
}

function num( v ) {
    let n = parseFloat( v );
    return isFinite( n ) ? n : 0;
}

function parseDay( text ) {
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec( String( text || "" ) );
    if ( !m ) return null;
    let d = new Date( Number( m[1] ), Number( m[2] ) - 1, Number( m[3] ) );
    if ( d.getFullYear() != m[1] || d.getMonth() != m[2] - 1 || d.getDate() != m[3] ) return null;
    return d;
}

function dayText( d ) {
    let pad = ( n ) => String( n ).padStart( 2, "0" );
    return d.getFullYear() + "-" + pad( d.getMonth() + 1 ) + "-" + pad( d.getDate() );
}

// Records kept by date only (expenses, GRNs, supplier payments): the time is
// when it was entered, if that was on the same day; otherwise just the day.
function dayAt( day, createdAt ) {
    let created = createdAt ? new Date( createdAt ) : null;
    if ( created && !isNaN( created ) && dayText( created ) === day ) {
        return { at: created.toJSON(), time_known: true };
    }
    let d = parseDay( day );
    return { at: d ? d.toJSON() : String( day ), time_known: false };
}

function toJSONDate( v ) {
    let d = v instanceof Date ? v : new Date( v );
    return isNaN( d ) ? String( v || "" ) : d.toJSON();
}

// same rule as transactions.js: the whole bill for a Credit sale, the unpaid
// part of a split payment
function saleCreditPart( t ) {
    let part = num( t.credit_amount );
    if ( t.payment_type === "Credit" ) return part > 0 ? part : num( t.total );
    return part > 0 ? part : 0;
}

const REFUND_METHODS = { cash: "Cash", card: "Card", bank: "Bank Transfer" };

function itemsText( items ) {
    return ( items || [] )
        .map( ( i ) => ( i.product_name || "" ) + " x" + ( parseInt( i.quantity ) || 0 ) )
        .join( ", " );
}

function buildEntries( data ) {
    let entries = [];

    data.sales.forEach( ( t ) => {
        let total = num( t.total );
        let credit = Math.min( saleCreditPart( t ), total );
        let advanceUsed = num( t.advance_used );
        let advanceDeposit = num( t.advance_deposit );
        let isCredit = t.payment_type === "Credit";
        // the bill's own payment; extra kept as advance is its own entry below
        let received = isCredit ? 0 : round2( Math.max( total - advanceUsed - credit, 0 ) );
        let reference = "Invoice " + ( t.order || t._id ) + ( t.ref_number ? " (" + t.ref_number + ")" : "" );
        let party = t.customer && t.customer != 0 ? t.customer.name || "" : "Walk in customer";
        let notes = [];
        if ( advanceUsed > 0 ) notes.push( "customer advance used " + advanceUsed.toFixed( 2 ) );
        if ( credit > 0 && !isCredit ) notes.push( credit.toFixed( 2 ) + " on credit" );
        if ( t.return_status === "full" ) notes.push( "returned" );
        else if ( t.return_status === "partial" ) notes.push( "partly returned" );
        entries.push( {
            kind: "sale",
            group: "sale",
            type: isCredit ? "Credit Sale" : "Sale",
            id: t._id,
            at: toJSONDate( t.date ),
            time_known: true,
            reference: reference,
            party: party,
            details: notes.join( "; " ),
            method: isCredit ? "Credit" : ( t.payment_type || "" ) + ( credit > 0 ? " + Credit" : "" ),
            in_method: received > 0 ? t.payment_type || "Other" : "",
            amount: round2( total ),
            money_in: received,
            money_out: 0,
            on_credit: round2( credit ),
            advance_used: round2( advanceUsed ),
            user: t.user || ""
        } );
        if ( advanceDeposit > 0 && !isCredit ) {
            entries.push( {
                kind: "customer_advance",
                group: "advance",
                type: "Customer Advance",
                id: t._id, // opens the sale's bill
                sale_id: t._id,
                at: toJSONDate( t.date ),
                time_known: true,
                reference: reference,
                party: party,
                details: "extra paid at the till, kept for the next bill",
                method: t.payment_type || "",
                in_method: t.payment_type || "Other",
                amount: round2( advanceDeposit ),
                money_in: round2( advanceDeposit ),
                money_out: 0,
                on_credit: 0,
                user: t.user || ""
            } );
        }
    } );

    data.returns.forEach( ( r ) => {
        let exchange = r.type === "exchange";
        let method = REFUND_METHODS[r.refund_method];
        let refunded = !exchange && method ? round2( r.refund_amount ) : 0;
        entries.push( {
            kind: exchange ? "exchange" : "return",
            group: "return",
            type: exchange ? "Exchange" : "Return",
            id: r._id,
            order_id: r.order_id,
            at: toJSONDate( r.date ),
            time_known: true,
            reference: "Invoice " + ( r.order_ref || r.order_id || "" ),
            party: "",
            details: [ itemsText( r.items ), r.reason ].filter( Boolean ).join( " - " ),
            method: exchange
                ? "Exchange credit"
                : method || ( r.refund_method === "store_credit" ? "Store credit" : r.refund_method || "" ),
            out_method: refunded > 0 ? method : "",
            amount: round2( r.refund_amount ),
            money_in: 0,
            money_out: refunded,
            on_credit: 0,
            user: r.user || ""
        } );
    } );

    // a customer settling credit; paying more than owed keeps the extra as the
    // customer's advance (its own entry)
    data.credit_payments.forEach( ( p ) => {
        let applied = round2( p.amount );
        let extra = round2( p.advance_added );
        let base = {
            id: p._id,
            customer_id: p.customer_id,
            receipt: p, // for the credit payment receipt
            at: toJSONDate( p.date ),
            time_known: true,
            reference: p.receipt_no || "",
            party: p.customer_name || "",
            method: p.method || "",
            in_method: p.method || "Other",
            money_out: 0,
            on_credit: 0,
            user: p.user || ""
        };
        if ( applied > 0 ) {
            entries.push( Object.assign( {}, base, {
                kind: "customer_credit_payment",
                group: "credit",
                type: "Customer Credit Payment",
                details: [
                    "balance " + num( p.balance_before ).toFixed( 2 ) + " -> " + num( p.balance_after ).toFixed( 2 ),
                    p.reference ? "ref " + p.reference : "",
                    p.note || ""
                ].filter( Boolean ).join( "; " ),
                amount: applied,
                money_in: applied
            } ) );
        }
        if ( extra > 0 ) {
            entries.push( Object.assign( {}, base, {
                kind: "customer_advance",
                group: "advance",
                type: "Customer Advance",
                details: "paid more than owed when settling credit, kept for the next bill",
                amount: extra,
                money_in: extra
            } ) );
        }
    } );

    data.expenses.forEach( ( e ) => {
        let when = dayAt( e.date, e.created_at );
        entries.push( {
            kind: "expense",
            group: "expense",
            type: "Expense",
            id: e._id,
            at: when.at,
            time_known: when.time_known,
            reference: e.type_name || "",
            party: "",
            details: e.description || "",
            method: e.payment_method || "",
            out_method: e.payment_method || "Other",
            amount: round2( e.amount ),
            money_in: 0,
            money_out: round2( e.amount ),
            on_credit: 0,
            user: e.created_by || ""
        } );
    } );

    data.grns.forEach( ( g ) => {
        let when = dayAt( g.received_date, g.created_at );
        let total = num( g.total );
        let advanceUsed = num( g.advance_used );
        let due = g.amount_due != null ? num( g.amount_due ) : total;
        let onCredit = g.payment_method === "Credit" ? due : 0;
        let paid = g.payment_method !== "Credit" && g.payment_method !== "Advance" ? due : 0;
        let notes = [ ( g.item_count || ( g.items || [] ).length ) + " products, " + ( g.total_quantity || 0 ) + " units" ];
        if ( advanceUsed > 0 ) notes.push( "supplier advance used " + advanceUsed.toFixed( 2 ) );
        if ( g.note ) notes.push( g.note );
        entries.push( {
            kind: "grn",
            group: "grn",
            type: "GRN",
            id: g._id,
            at: when.at,
            time_known: when.time_known,
            reference: g.grn_no || "",
            party: ( g.supplier_name || "" ) + ( g.walk_in && g.supplier_name !== "Walk-in seller" ? " (Walk-in)" : "" ),
            details: notes.join( "; " ),
            method:
                g.payment_method === "Advance"
                    ? "Supplier advance"
                    : ( advanceUsed > 0 ? "Advance + " : "" ) + ( g.payment_method || "" ),
            out_method: paid > 0 ? g.payment_method : "",
            amount: round2( total ),
            money_in: 0,
            money_out: round2( paid ),
            on_credit: round2( onCredit ),
            advance_used: round2( advanceUsed ),
            user: g.created_by || ""
        } );
    } );

    // a supplier payment settles what is owed first (credit payment); the rest
    // is paid in advance (its own entry)
    data.supplier_payments.forEach( ( p ) => {
        let when = dayAt( p.date, p.created_at );
        let toAdvance = round2( p.to_advance );
        let toCredit = round2( p.to_credit != null ? num( p.to_credit ) : num( p.amount ) - toAdvance );
        let base = {
            id: p._id,
            supplier_id: p.supplier_id,
            at: when.at,
            time_known: when.time_known,
            reference: p.payment_no || "",
            party: p.supplier_name || "",
            method: p.payment_method || "",
            out_method: p.payment_method || "Other",
            money_in: 0,
            on_credit: 0,
            user: p.created_by || ""
        };
        let before = p.position_before != null ? num( p.position_before ) : null;
        if ( toCredit > 0 ) {
            entries.push( Object.assign( {}, base, {
                kind: "supplier_credit_payment",
                group: "credit",
                type: "Supplier Credit Payment",
                details: [
                    before !== null ? "owed " + Math.max( before, 0 ).toFixed( 2 ) + " -> " + Math.max( before - toCredit, 0 ).toFixed( 2 ) : "",
                    p.note || ""
                ].filter( Boolean ).join( "; " ),
                amount: toCredit,
                money_out: toCredit
            } ) );
        }
        if ( toAdvance > 0 ) {
            entries.push( Object.assign( {}, base, {
                kind: "supplier_advance",
                group: "advance",
                type: "Supplier Advance",
                details: [ "paid in advance, used by the next GRNs", toCredit > 0 ? "" : p.note || "" ]
                    .filter( Boolean ).join( "; " ),
                amount: toAdvance,
                money_out: toAdvance
            } ) );
        }
    } );

    // purchase returns: goods sent back to a supplier; a refund is money in,
    // a deduction from the supplier's balance moves no money
    ( data.prns || [] ).forEach( ( r ) => {
        let when = dayAt( r.return_date, r.created_at );
        let credit = r.refund_method === "Credit";
        let total = round2( r.total );
        entries.push( {
            kind: "prn",
            group: "grn",
            type: "Purchase Return",
            id: r._id,
            at: when.at,
            time_known: when.time_known,
            reference: r.prn_no || "",
            party: ( r.supplier_name || "" ) + ( r.walk_in && r.supplier_name !== "Walk-in seller" ? " (Walk-in)" : "" ),
            details: [
                ( r.item_count || ( r.items || [] ).length ) + " products, " + ( r.total_quantity || 0 ) + " units",
                r.grn_ref ? "GRN " + r.grn_ref : "",
                r.note || ""
            ].filter( Boolean ).join( "; " ),
            method: credit ? "Deducted from supplier" : r.refund_method || "",
            in_method: credit ? "" : r.refund_method || "Other",
            amount: total,
            money_in: credit ? 0 : total,
            money_out: 0,
            on_credit: 0,
            user: r.created_by || ""
        } );
    } );

    // stock adjustments: stock written off (expired, damaged, lost...) or
    // found, valued at cost; they move no money
    ( data.adjustments || [] ).forEach( ( a ) => {
        let when = dayAt( a.date, a.created_at );
        let out = a.direction === "out";
        entries.push( {
            kind: "adjustment",
            group: "stock",
            type: out ? "Stock Written Off" : "Stock Added",
            id: a._id,
            at: when.at,
            time_known: when.time_known,
            reference: a.adj_no || "",
            party: a.reason || "",
            details: [
                ( a.items || [] ).map( ( i ) => ( i.product_name || "" ) + " x" + ( parseInt( i.quantity ) || 0 ) ).join( ", " ),
                a.note || ""
            ].filter( Boolean ).join( "; " ),
            method: "No money",
            amount: round2( a.total_value ),
            money_in: 0,
            money_out: 0,
            on_credit: 0,
            user: a.created_by || ""
        } );
    } );

    // money moved between methods (Day End): one method down, another up by
    // the same amount; no money comes in or goes out of the shop
    ( data.transfers || [] ).forEach( ( t ) => {
        let when = dayAt( t.date, t.created_at );
        entries.push( {
            kind: "transfer",
            group: "transfer",
            type: "Money Transfer",
            id: t._id,
            at: when.at,
            time_known: when.time_known,
            reference: t.transfer_no || "",
            party: "",
            details: [ t.reference ? "ref " + t.reference : "", t.note || "" ].filter( Boolean ).join( "; " ),
            method: ( t.from || "" ) + " -> " + ( t.to || "" ),
            transfer_from: t.from,
            transfer_to: t.to,
            amount: round2( t.amount ),
            money_in: 0,
            money_out: 0,
            on_credit: 0,
            user: t.created_by || ""
        } );
    } );

    entries.sort( ( a, b ) => String( a.at ).localeCompare( String( b.at ) ) );
    return entries;
}

function buildSummary( entries ) {
    let group = () => ( { count: 0, total: 0 } );
    let s = {
        sales: Object.assign( group(), { received: 0, on_credit: 0 } ),
        returns: Object.assign( group(), { refunded: 0 } ),
        exchanges: group(),
        credit_received: group(), // customers settling credit
        advance_received: group(), // customers paying in advance
        expenses: group(),
        grns: Object.assign( group(), { paid: 0, on_credit: 0 } ),
        credit_paid: group(), // settling suppliers' credit
        advance_paid: group(), // paying suppliers in advance
        prns: Object.assign( group(), { refunded: 0, credited: 0 } ), // goods sent back to suppliers
        written_off: group(), // stock adjustments out (at cost)
        stock_added: group(), // stock adjustments in (at cost)
        transfers: group(), // money moved between methods (no money in or out)
        advance_used: { customers: 0, suppliers: 0 }, // moves no money that day
        methods: {},
        money_in: 0,
        money_out: 0
    };
    let method = ( name ) => ( s.methods[name] = s.methods[name] || { in: 0, out: 0, transfer_in: 0, transfer_out: 0 } );
    // the usual methods always listed, in this order
    [ "Cash", "Card", "Bank Transfer" ].forEach( method );

    entries.forEach( ( e ) => {
        let key = {
            sale: "sales",
            return: "returns",
            exchange: "exchanges",
            customer_credit_payment: "credit_received",
            customer_advance: "advance_received",
            expense: "expenses",
            grn: "grns",
            supplier_credit_payment: "credit_paid",
            supplier_advance: "advance_paid",
            prn: "prns",
            adjustment: e.type === "Stock Added" ? "stock_added" : "written_off",
            transfer: "transfers"
        }[e.kind];
        s[key].count++;
        s[key].total += e.amount;
        if ( e.kind === "sale" ) {
            s.sales.received += e.money_in;
            s.sales.on_credit += e.on_credit;
            s.advance_used.customers += e.advance_used || 0;
        }
        if ( e.kind === "return" ) s.returns.refunded += e.money_out;
        if ( e.kind === "prn" ) {
            if ( e.money_in > 0 ) s.prns.refunded += e.money_in;
            else s.prns.credited += e.amount;
        }
        if ( e.kind === "grn" ) {
            s.grns.paid += e.money_out;
            s.grns.on_credit += e.on_credit;
            s.advance_used.suppliers += e.advance_used || 0;
        }
        if ( e.kind === "transfer" ) {
            method( e.transfer_from ).transfer_out += e.amount;
            method( e.transfer_to ).transfer_in += e.amount;
        }
        if ( e.money_in > 0 ) method( e.in_method ).in += e.money_in;
        if ( e.money_out > 0 ) method( e.out_method ).out += e.money_out;
        s.money_in += e.money_in;
        s.money_out += e.money_out;
    } );

    let roundAll = ( o ) =>
        Object.keys( o ).forEach( ( k ) => {
            if ( typeof o[k] === "number" && k !== "count" ) o[k] = round2( o[k] );
            else if ( o[k] && typeof o[k] === "object" ) roundAll( o[k] );
        } );
    roundAll( s );
    Object.keys( s.methods ).forEach( ( k ) => {
        // what the method holds after the day: money in - money out, plus
        // what was moved into it, minus what was moved out of it
        let m = s.methods[k];
        m.transfers = round2( m.transfer_in - m.transfer_out );
        m.net = round2( m.in - m.out + m.transfers );
    } );
    s.net = round2( s.money_in - s.money_out );
    return s;
}

app.get( "/", function ( req, res ) {
    let fromDay = parseDay( req.query.from );
    let toDay = req.query.to ? parseDay( req.query.to ) : fromDay;
    if ( !fromDay || !toDay ) return res.status( 400 ).send( "Please choose a valid date." );
    if ( toDay < fromDay ) return res.status( 400 ).send( "The end date is before the start date." );

    let from = new Date( fromDay.getFullYear(), fromDay.getMonth(), fromDay.getDate(), 0, 0, 0, 0 );
    let to = new Date( toDay.getFullYear(), toDay.getMonth(), toDay.getDate(), 23, 59, 59, 999 );
    let fromText = dayText( fromDay );
    let toText = dayText( toDay );

    Transactions.journalData( from, to, function ( err, sales ) {
        if ( err ) return res.status( 500 ).send( "Could not load the sales." );
        Expenses.journalData( fromText, toText, function ( err, expenses ) {
            if ( err ) return res.status( 500 ).send( "Could not load the expenses." );
            Suppliers.journalData( fromText, toText, function ( err, purchases ) {
                if ( err ) return res.status( 500 ).send( "Could not load the GRNs and supplier payments." );
                Adjustments.findBetween( fromText, toText, function ( err, adjustments ) {
                if ( err ) return res.status( 500 ).send( "Could not load the stock adjustments." );
                Transfers.findBetween( fromText, toText, function ( err, transfers ) {
                if ( err ) return res.status( 500 ).send( "Could not load the money transfers." );
                let entries = buildEntries( {
                    sales: sales.sales,
                    returns: sales.returns,
                    credit_payments: sales.credit_payments,
                    expenses: expenses,
                    grns: purchases.grns,
                    supplier_payments: purchases.supplier_payments,
                    prns: purchases.prns,
                    adjustments: adjustments,
                    transfers: transfers
                } );
                res.send( { from: fromText, to: toText, entries: entries, summary: buildSummary( entries ) } );
                } );
                } );
            } );
        } );
    } );
} );
