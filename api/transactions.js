let app = require("express")();
let server = require("http").Server(app);
let bodyParser = require("body-parser");
let Datastore = require("nedb");
let Inventory = require("./inventory");

app.use(bodyParser.json());

module.exports = app;
 
let transactionsDB = new Datastore({
  filename: process.env.APPDATA+"/POS/server/databases/transactions.db",
  autoload: true
});


transactionsDB.ensureIndex({ fieldName: '_id', unique: true });

let returnsDB = new Datastore({
  filename: process.env.APPDATA+"/POS/server/databases/returns.db",
  autoload: true
});

returnsDB.ensureIndex({ fieldName: '_id', unique: true });

// Credit settlements: money a customer pays back against their Credit sales.
// Outstanding balance = total Credit sales - total payments.
let creditPaymentsDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/credit_payments.db",
  autoload: true
});

creditPaymentsDB.ensureIndex({ fieldName: "customer_id" });

function customerIdForms(raw) {
  let n = parseInt(raw);
  return isNaN(n) ? [raw] : [n, String(n)];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Sales that put money on a customer's credit:
//  - Credit sales (the whole bill, or credit_amount if set)
//  - split payments: paid partly by Cash / Card / Bank Transfer with the
//    rest on credit (payment_type is the method, credit_amount the rest)
const CREDIT_SALES_QUERY = { $or: [{ payment_type: "Credit" }, { credit_amount: { $gt: 0 } }] };

function creditPortion(t) {
  let part = parseFloat(t.credit_amount);
  if (t.payment_type === "Credit") return part > 0 ? part : parseFloat(t.total) || 0;
  return part > 0 ? part : 0;
}

// callback(err, { credit, paid, balance }) for one customer.
// excludeOrder: an order being re-saved, so it isn't counted twice.
function customerCreditPosition(customerId, excludeOrder, callback) {
  let ids = customerIdForms(customerId);
  transactionsDB.find(
    { $and: [{ "customer.id": { $in: ids } }, CREDIT_SALES_QUERY] },
    function(err, sales) {
      if (err) return callback(err);
      creditPaymentsDB.find({ customer_id: { $in: ids } }, function(err, payments) {
        if (err) return callback(err);
        let credit = (sales || [])
          .filter(function(t) { return !excludeOrder || String(t._id) !== String(excludeOrder); })
          .reduce(function(s, t) { return s + creditPortion(t); }, 0);
        let paid = (payments || []).reduce(function(s, p) { return s + (parseFloat(p.amount) || 0); }, 0);
        callback(null, { credit: round2(credit), paid: round2(paid), balance: round2(Math.max(credit - paid, 0)) });
      });
    }
  );
}

app.get("/", function(req, res) {
  res.send("Transactions API");
});

 
app.get("/all", function(req, res) {
  transactionsDB.find({}, function(err, docs) {
    res.send(docs);
  });
});



 
app.get("/on-hold", function(req, res) {
  transactionsDB.find(
    { $and: [{ ref_number: {$ne: ""}}, { status: 0  }]},    
    function(err, docs) {
      if (docs) res.send(docs);
    }
  );
});



app.get("/customer-orders", function(req, res) {
  transactionsDB.find(
    { $and: [{ customer: {$ne: "0"} }, { status: 0}, { ref_number: ""}]},
    function(err, docs) {
      if (docs) res.send(docs);
    }
  );
});



app.get("/by-date", function(req, res) {
  // start/end are optional: leaving either out (the Transactions page's
  // "Clear" / All dates) removes that side of the date limit
  let startDate = req.query.start ? new Date(req.query.start) : null;
  let endDate = req.query.end ? new Date(req.query.end) : null;
  if ((startDate && isNaN(startDate)) || (endDate && isNaN(endDate))) {
    return res.status(400).send("Invalid start or end date.");
  }
  let status = parseInt(req.query.status);
  if (isNaN(status)) status = 1;
  let user = parseInt(req.query.user) || 0;
  let till = parseInt(req.query.till) || 0;

  let query = { $and: [] };
  let dateRange = {};
  if (startDate) dateRange.$gte = startDate.toJSON();
  if (endDate) dateRange.$lte = endDate.toJSON();
  if (startDate || endDate) query.$and.push({ date: dateRange });

  // Paid = Cash / Card / Bank Transfer sales; Unpaid = Credit sales;
  // ("Mpesa" stays in the list only so sales recorded before Mpesa was
  // removed from the system still show up in reports)
  // All (2) = Paid + Unpaid. Held orders (status 0, not Credit) are excluded from all.
  let paidQuery = { $and: [{ status: 1 }, { payment_type: { $in: ["Cash", "Card", "Bank Transfer", "Mpesa"] } }] };
  let unpaidQuery = CREDIT_SALES_QUERY; // Credit sales + split payments with a part on credit

  if (status === 0) {
    query.$and.push(unpaidQuery);
  } else if (status === 2) {
    query.$and.push({ $or: [paidQuery, unpaidQuery] });
  } else {
    query.$and.push(paidQuery);
  }

  if (user !== 0) {
    query.$and.push({ user_id: user });
  }
  if (till !== 0) {
    query.$and.push({ till: till });
  }

  transactionsDB.find(query, function(err, docs) {
    if (err) {
      return res.status(500).send(err);
    }
    res.send(docs || []);
  });
});


// All completed (Cash / Card / Bank Transfer) and Credit transactions
// ("Mpesa" below only matches sales recorded before Mpesa was removed)
// for one registered customer, newest first. Held orders are excluded.
app.get("/by-customer/:customerId", function(req, res) {
  let rawId = req.params.customerId;
  let numericId = parseInt(rawId);
  let ids = isNaN(numericId) ? [rawId] : [numericId, String(numericId)];

  let paidQuery = { $and: [{ status: 1 }, { payment_type: { $in: ["Cash", "Card", "Bank Transfer", "Mpesa"] } }] };
  let creditQuery = { payment_type: "Credit" };

  transactionsDB.find(
    { $and: [{ "customer.id": { $in: ids } }, { $or: [paidQuery, creditQuery] }] }
  ).sort({ date: -1 }).exec(function(err, docs) {
    if (err) return res.status(500).send(err);
    res.send(docs || []);
  });
});


// Total of a customer's Credit sales, used to enforce their credit limit.
// ?exclude=<orderId> leaves out an order that is being re-saved.
// Credit in use for the credit-limit check at the till: Credit sales minus
// what the customer has already paid back.
app.get("/customer-credit/:customerId", function(req, res) {
  customerCreditPosition(req.params.customerId, req.query.exclude, function(err, pos) {
    if (err) return res.status(500).send(err);
    res.send({ used: pos.balance, credit: pos.credit, paid: pos.paid });
  });
});

// Outstanding balance for every customer: { "<customerId>": { credit, paid, balance } }
app.get("/credit-balances", function(req, res) {
  transactionsDB.find(CREDIT_SALES_QUERY, function(err, sales) {
    if (err) return res.status(500).send(err);
    creditPaymentsDB.find({}, function(err, payments) {
      if (err) return res.status(500).send(err);
      let out = {};
      let entry = function(id) {
        return (out[String(id)] = out[String(id)] || { credit: 0, paid: 0, balance: 0 });
      };
      (sales || []).forEach(function(t) {
        if (t.customer && t.customer.id != null) entry(t.customer.id).credit += creditPortion(t);
      });
      (payments || []).forEach(function(p) {
        entry(p.customer_id).paid += parseFloat(p.amount) || 0;
      });
      advancesDB.find({}, function(err, advances) {
        if (err) return res.status(500).send(err);
        (advances || []).forEach(function(e) {
          let a = entry(e.customer_id);
          a.advance = (a.advance || 0) + (e.type === "deposit" ? 1 : -1) * (parseFloat(e.amount) || 0);
        });
        Object.keys(out).forEach(function(k) {
          out[k].credit = round2(out[k].credit);
          out[k].paid = round2(out[k].paid);
          out[k].balance = round2(Math.max(out[k].credit - out[k].paid, 0));
          out[k].advance = round2(Math.max(out[k].advance || 0, 0));
        });
        res.send(out);
      });
    });
  });
});

// One customer's balance + their payments (newest first)
app.get("/credit-payments/:customerId", function(req, res) {
  customerCreditPosition(req.params.customerId, null, function(err, pos) {
    if (err) return res.status(500).send(err);
    creditPaymentsDB.find({ customer_id: { $in: customerIdForms(req.params.customerId) } })
      .sort({ date: -1 })
      .exec(function(err, payments) {
        if (err) return res.status(500).send(err);
        // the customer's advance (money kept for the next bill) comes along too
        advancesDB.find({ customer_id: { $in: customerIdForms(req.params.customerId) } })
          .sort({ date: -1 })
          .exec(function(err, advances) {
            if (err) return res.status(500).send(err);
            let advance = (advances || []).reduce(function(s, e) {
              return s + (e.type === "deposit" ? 1 : -1) * (parseFloat(e.amount) || 0);
            }, 0);
            res.send(Object.assign({
              payments: payments || [],
              advance: round2(Math.max(advance, 0)),
              advance_entries: advances || []
            }, pos));
          });
      });
  });
});

// Record a credit settlement. Body: { customer_id, customer_name, amount,
// method, reference, note, user, user_id, till }. The amount must be a
// positive number and can't be more than the outstanding balance.
app.post("/credit-payments", function(req, res) {
  let b = req.body || {};
  let amountText = String(b.amount ?? "").trim();
  if (!/^(\d+(\.\d{1,2})?|\d*\.\d{1,2})$/.test(amountText) || parseFloat(amountText) <= 0) {
    return res.status(400).send("Enter a payment amount greater than 0 (e.g. 500 or 500.50).");
  }
  if (b.customer_id === undefined || b.customer_id === null || b.customer_id === "" || b.customer_id == 0) {
    return res.status(400).send("A registered customer is required.");
  }
  let methods = ["Cash", "Card", "Bank Transfer"];
  let method = methods.indexOf(b.method) !== -1 ? b.method : "Cash";
  let amount = round2(parseFloat(amountText));

  customerCreditPosition(b.customer_id, null, function(err, pos) {
    if (err) return res.status(500).send(err);
    if (pos.balance <= 0) return res.status(400).send("This customer has no outstanding credit.");
    // paying more than owed: the balance is cleared and the extra is kept as
    // an advance for the customer's next bill
    let applied = round2(Math.min(amount, pos.balance));
    let extra = round2(amount - applied);
    let id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    let customerId = isNaN(parseInt(b.customer_id)) ? b.customer_id : parseInt(b.customer_id);
    let doc = {
      _id: id,
      // unique per payment (the id includes milliseconds + a random part)
      receipt_no: "CP-" + String(id).slice(-11),
      customer_id: customerId,
      customer_name: b.customer_name || "",
      amount: applied,           // what went against the credit
      received: amount,          // what the customer handed over
      advance_added: extra,      // kept for the next bill
      method: method,
      reference: String(b.reference || "").slice(0, 100),
      note: String(b.note || "").slice(0, 300),
      balance_before: pos.balance,
      balance_after: round2(Math.max(pos.balance - applied, 0)),
      user: b.user || "",
      user_id: b.user_id || "",
      till: b.till || "",
      date: new Date()
    };
    creditPaymentsDB.insert(doc, function(err, saved) {
      if (err) return res.status(500).send(err);
      if (!extra) return res.send(saved);
      advancesDB.insert({
        customer_id: customerId,
        customer_name: doc.customer_name,
        type: "deposit",
        amount: extra,
        source: "settlement",
        receipt_no: doc.receipt_no,
        reference: "Credit settlement " + doc.receipt_no,
        user: doc.user,
        date: new Date()
      }, function(err) {
        if (err) console.error("Failed to record customer advance:", err);
        customerAdvanceBalance(customerId, null, function(err, advance) {
          res.send(Object.assign({ advance_balance: advance || 0 }, saved));
        });
      });
    });
  });
});



// Everything that happened to one product, newest first:
//  - sale / credit_sale / held  (from transactions; stock goes down when saved)
//  - return / exchange          (from returns; stock goes up only if restocked)
//  - created / updated / stock_adjustment / deleted (from the product log)
app.get("/product-history/:productId", function(req, res) {
  let numericId = parseInt(req.params.productId);
  if (isNaN(numericId)) return res.status(400).send("Invalid product ID");
  let ids = [numericId, String(numericId)];
  let isThisProduct = function(item) { return item && ids.indexOf(item.id) !== -1; };
  let events = [];

  transactionsDB.find({ "items.id": { $in: ids } }, function(err, transactions) {
    if (err) return res.status(500).send(err);

    (transactions || []).forEach(function(t) {
      let lines = (t.items || []).filter(isThisProduct);
      let qty = lines.reduce(function(s, i) { return s + (parseInt(i.quantity) || 0); }, 0);
      if (!qty) return;
      let price = parseFloat(lines[0].price) || 0;
      let type = t.payment_type === "Credit" ? "credit_sale" : (t.status == 1 ? "sale" : "held");

      events.push({
        type: type,
        date: t.date,
        reference: t.order,
        transaction_id: t._id,
        qty_change: -qty,
        price: price,
        amount: Math.round(price * qty * 100) / 100,
        payment_type: t.payment_type,
        customer: t.customer && t.customer != 0 ? t.customer.name : "Walk in customer",
        user: t.user || "",
        return_status: t.return_status || ""
      });
    });

    returnsDB.find({ "items.id": { $in: ids } }, function(err, returns) {
      if (err) return res.status(500).send(err);

      (returns || []).forEach(function(r) {
        let lines = (r.items || []).filter(isThisProduct);
        let qty = lines.reduce(function(s, i) { return s + (parseInt(i.quantity) || 0); }, 0);
        if (!qty) return;
        let price = parseFloat(lines[0].price) || 0;

        events.push({
          type: r.type === "exchange" ? "exchange" : "return",
          date: r.date,
          reference: r.order_ref || r.order_id,
          transaction_id: r.order_id,
          qty_change: r.restocked ? qty : 0,
          returned_qty: qty,
          restocked: !!r.restocked,
          price: price,
          amount: Math.round(price * qty * 100) / 100,
          refund_method: r.refund_method || "",
          reason: r.reason || "",
          user: r.user || ""
        });
      });

      Inventory.getHistory(numericId, function(err, logs) {
        if (err) return res.status(500).send(err);
        (logs || []).forEach(function(l) { events.push(l); });

        events.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
        res.send(events);
      });
    });
  });
});


// ---- Customer advance (money paid in advance for the next bill) ----
// Ledger of deposits (extra paid at the till or when settling credit) and
// uses (advance applied to a bill). Balance = deposits - uses.
let advancesDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/customer_advances.db",
  autoload: true
});

advancesDB.ensureIndex({ fieldName: "customer_id" });

// callback(err, balance). excludeOrder: leave out the entries of an order
// that is being saved again (so its own advance isn't counted twice)
function customerAdvanceBalance(customerId, excludeOrder, callback) {
  advancesDB.find({ customer_id: { $in: customerIdForms(customerId) } }, function(err, entries) {
    if (err) return callback(err);
    let balance = (entries || [])
      .filter(function(e) { return !excludeOrder || String(e.order_id) !== String(excludeOrder) || e.source !== "sale"; })
      .reduce(function(s, e) { return s + (e.type === "deposit" ? 1 : -1) * (parseFloat(e.amount) || 0); }, 0);
    callback(null, round2(Math.max(balance, 0)));
  });
}

function registeredCustomerId(customer) {
  return customer && customer != 0 && customer.id != null && customer.id !== "" ? customer.id : null;
}

function advanceNumber(value) {
  let n = parseFloat(value);
  return isNaN(n) || n < 0 ? 0 : round2(n);
}

// Split payment: the part put on credit must be a positive number, not more
// than the bill, and only for a registered customer
function checkSaleCredit(t) {
  if (t.credit_amount === undefined || t.credit_amount === null || t.credit_amount === "" || t.credit_amount === 0) return null;
  let part = parseFloat(t.credit_amount);
  if (isNaN(part) || part < 0) return "The amount put on credit must be a positive number.";
  if (part === 0) return null;
  if (registeredCustomerId(t.customer) === null) return "Only a registered customer can put part of a bill on credit.";
  if (part > (parseFloat(t.total) || 0) + 0.001) return "The amount put on credit can't be more than the bill.";
  t.credit_amount = round2(part);
  return null;
}

// Checks a sale's advance_used against the customer's advance; callback(errorMessage|null)
function checkSaleAdvance(t, callback) {
  let creditError = checkSaleCredit(t);
  if (creditError) return callback(creditError);
  let used = advanceNumber(t.advance_used);
  let deposit = advanceNumber(t.advance_deposit);
  if (!used && !deposit) return callback(null);
  let customerId = registeredCustomerId(t.customer);
  if (customerId === null) return callback("Advance can only be used or saved for a registered customer.");
  if (t.payment_type === "Credit") return callback("Advance can't be used or saved on a Credit sale.");
  if (!used) return callback(null);
  customerAdvanceBalance(customerId, t._id, function(err, balance) {
    if (err) return callback("Could not check the customer's advance.");
    if (used > balance + 0.001) return callback("The customer only has " + balance.toFixed(2) + " in advance.");
    callback(null);
  });
}

// Writes a completed sale's advance use / deposit to the ledger (replacing any
// earlier entries for the same order, so saving an order again is safe)
function recordSaleAdvance(t, callback) {
  callback = callback || function() {};
  let customerId = registeredCustomerId(t.customer);
  if (customerId === null || t.status != 1) return callback();
  advancesDB.remove({ order_id: t._id, source: "sale" }, { multi: true }, function() {
    let entries = [];
    let base = {
      customer_id: isNaN(parseInt(customerId)) ? customerId : parseInt(customerId),
      customer_name: (t.customer && t.customer.name) || "",
      source: "sale",
      order_id: t._id,
      reference: "Invoice " + (t.order || t._id),
      user: t.user || "",
      date: new Date()
    };
    let used = advanceNumber(t.advance_used), deposit = advanceNumber(t.advance_deposit);
    if (used) entries.push(Object.assign({ type: "use", amount: used }, base));
    if (deposit) entries.push(Object.assign({ type: "deposit", amount: deposit }, base));
    if (!entries.length) return callback();
    advancesDB.insert(entries, function(err) {
      if (err) console.error("Failed to record customer advance:", err);
      callback();
    });
  });
}

// A customer's advance balance + its history (newest first)
app.get("/customer-advance/:customerId", function(req, res) {
  customerAdvanceBalance(req.params.customerId, null, function(err, balance) {
    if (err) return res.status(500).send(err);
    advancesDB.find({ customer_id: { $in: customerIdForms(req.params.customerId) } })
      .sort({ date: -1 })
      .exec(function(err, entries) {
        if (err) return res.status(500).send(err);
        res.send({ balance: balance, entries: entries || [] });
      });
  });
});


app.post("/new", function(req, res) {
  let newTransaction = req.body;
  checkSaleAdvance(newTransaction, function(advanceError) {
  if (advanceError) return res.status(400).send(advanceError);
  transactionsDB.insert(newTransaction, function(err, transaction) {
    if (err) {
      return res.status(500).send(err);
    }

    recordSaleAdvance(transaction);

    // Handle transaction creation successfully
    res.status(200).send("Transaction created successfully.");

    // Call app.decrementInventory regardless of paid amount
    Inventory.decrementInventory(newTransaction.items, function(err, result) {
      if (err) {
        console.error("Error decrementing inventory:", err);
      } else {
        console.log("Inventory updated successfully.");
      }
    });
  });
  });
});



app.put("/new", function(req, res) {
  let oderId = req.body._id;
  checkSaleAdvance(req.body, function(advanceError) {
    if (advanceError) return res.status(400).send(advanceError);
    transactionsDB.update( {
        _id: oderId
    }, req.body, {}, function (
        err,
        numReplaced,
        order
    ) {
        if ( err ) return res.status( 500 ).send( err );
        // a held order completed with an advance used / saved
        recordSaleAdvance(req.body);
        res.sendStatus( 200 );
    } );
  });
});


app.post( "/delete", function ( req, res ) {
 let transaction = req.body;
  transactionsDB.remove( {
      _id: transaction.orderId
  }, function ( err, numRemoved ) {
      if ( err ) res.status( 500 ).send( err );
      else res.sendStatus( 200 );
  } );
} );



// Returns/exchanges for a list of orders (used by the Transactions page profit
// section). Body: { ids: [orderId, ...] }
app.post("/returns/for-orders", function(req, res) {
  let ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  // order ids are usually numbers but may have been stored as text: match both
  let all = [];
  ids.forEach(function(id) {
    all.push(String(id));
    if (!isNaN(Number(id))) all.push(Number(id));
  });
  if (!all.length) return res.send([]);
  returnsDB.find({ order_id: { $in: all } }, function(err, docs) {
    if (err) return res.status(500).send(err);
    res.send(docs || []);
  });
});


app.get("/returns/order/:orderId", function(req, res) {
  returnsDB.find({ order_id: req.params.orderId }, function(err, docs) {
    if (err) return res.status(500).send(err);
    res.send(docs);
  });
});


app.post("/returns", function(req, res) {
  let body = req.body;
  let orderId = body.order_id;

  transactionsDB.findOne({ _id: orderId }, function(err, order) {
    if (err) return res.status(500).send(err);
    if (!order) return res.status(404).send("Original transaction not found.");

    returnsDB.find({ order_id: orderId }, function(err, existingReturns) {
      if (err) return res.status(500).send(err);

      let alreadyReturned = {};
      existingReturns.forEach(function(ret) {
        ret.items.forEach(function(item) {
          alreadyReturned[item.id] = (alreadyReturned[item.id] || 0) + parseInt(item.quantity);
        });
      });

      for (let i = 0; i < body.items.length; i++) {
        let requestedItem = body.items[i];
        let originalItem = order.items.find(function(item) { return item.id == requestedItem.id; });

        if (!originalItem) {
          return res.status(400).send("Item " + requestedItem.product_name + " was not part of the original order.");
        }

        let alreadyReturnedQty = alreadyReturned[requestedItem.id] || 0;
        let remaining = parseInt(originalItem.quantity) - alreadyReturnedQty;

        if (parseInt(requestedItem.quantity) <= 0 || parseInt(requestedItem.quantity) > remaining) {
          return res.status(400).send("Cannot return " + requestedItem.quantity + " of " + requestedItem.product_name + ". Only " + remaining + " remaining.");
        }
      }

      let refundAmount = body.items.reduce(function(sum, item) {
        return sum + (parseFloat(item.price) * parseInt(item.quantity));
      }, 0);

      let returnDoc = {
        _id: Date.now(),
        order_id: orderId,
        order_ref: order.ref_number || order.order,
        type: body.type === "exchange" ? "exchange" : "return",
        items: body.items,
        reason: body.reason || "",
        refund_amount: refundAmount,
        refund_method: body.refund_method || "",
        restocked: !!body.restock,
        till: body.till,
        mac: body.mac,
        user: body.user,
        user_id: body.user_id,
        date: new Date()
      };

      returnsDB.insert(returnDoc, function(err, inserted) {
        if (err) return res.status(500).send(err);

        function finish() {
          returnsDB.find({ order_id: orderId }, function(err, allReturns) {
            let returnedQty = {};
            allReturns.forEach(function(ret) {
              ret.items.forEach(function(item) {
                returnedQty[item.id] = (returnedQty[item.id] || 0) + parseInt(item.quantity);
              });
            });

            let fullyReturned = order.items.every(function(item) {
              return (returnedQty[item.id] || 0) >= parseInt(item.quantity);
            });
            let anyReturned = order.items.some(function(item) {
              return (returnedQty[item.id] || 0) > 0;
            });

            let returnStatus = fullyReturned ? "full" : (anyReturned ? "partial" : "none");

            transactionsDB.update(
              { _id: orderId },
              { $set: { return_status: returnStatus }, $inc: { returned_amount: refundAmount } },
              {},
              function(err) {
                if (err) return res.status(500).send(err);
                res.status(200).send({ return: inserted, refund_amount: refundAmount });
              }
            );
          });
        }

        if (body.restock) {
          Inventory.incrementInventory(body.items, function(err) {
            if (err) console.error("Error incrementing inventory:", err);
            finish();
          });
        } else {
          finish();
        }
      });
    });
  });
});


app.get("/:transactionId", function(req, res) {
  // _id is usually stored as a number (the order number), so match both forms
  let raw = req.params.transactionId;
  let ids = isNaN(parseInt(raw)) ? [raw] : [parseInt(raw), raw];
  transactionsDB.find({ _id: { $in: ids } }, function(err, doc) {
    if (err) return res.status(500).send(err);
    if (!doc || !doc.length) return res.status(404).send("Transaction not found.");
    res.send(doc[0]);
  });
});
