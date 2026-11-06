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

  // Paid = Cash / Card / Bank Transfer (and Mpesa) sales; Unpaid = Credit sales;
  // All (2) = Paid + Unpaid. Held orders (status 0, not Credit) are excluded from all.
  let paidQuery = { $and: [{ status: 1 }, { payment_type: { $in: ["Cash", "Card", "Bank Transfer", "Mpesa"] } }] };
  let unpaidQuery = { payment_type: "Credit" };

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


// All completed (Cash / Card / Bank Transfer / Mpesa) and Credit transactions
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
app.get("/customer-credit/:customerId", function(req, res) {
  let rawId = req.params.customerId;
  let numericId = parseInt(rawId);
  let ids = isNaN(numericId) ? [rawId] : [numericId, String(numericId)];
  let exclude = req.query.exclude;

  transactionsDB.find(
    { $and: [{ "customer.id": { $in: ids } }, { payment_type: "Credit" }] },
    function(err, docs) {
      if (err) return res.status(500).send(err);
      let used = (docs || [])
        .filter(function(t) { return !exclude || String(t._id) !== String(exclude); })
        .reduce(function(sum, t) { return sum + (parseFloat(t.total) || 0); }, 0);
      res.send({ used: Math.round(used * 100) / 100 });
    }
  );
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


app.post("/new", function(req, res) {
  let newTransaction = req.body;
  transactionsDB.insert(newTransaction, function(err, transaction) {    
    if (err) {
      return res.status(500).send(err);
    }

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



app.put("/new", function(req, res) {
  let oderId = req.body._id;
  transactionsDB.update( {
      _id: oderId
  }, req.body, {}, function (
      err,
      numReplaced,
      order
  ) {
      if ( err ) res.status( 500 ).send( err );
      else res.sendStatus( 200 );
  } );
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
