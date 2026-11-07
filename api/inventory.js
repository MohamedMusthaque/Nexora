const app = require("express")();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const Datastore = require("nedb");
const async = require("async");
const fileUpload = require("express-fileupload");
const multer = require("multer");
const fs = require("fs");

const storage = multer.diskStorage({
  destination: process.env.APPDATA + "/POS/uploads",
  filename: function (req, file, callback) {
    callback(null, Date.now() + ".jpg"); //
  },
});

let upload = multer({ storage: storage });

app.use(bodyParser.json());

module.exports = app;

let inventoryDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/inventory.db",
  autoload: true,
});

inventoryDB.ensureIndex({ fieldName: "_id", unique: true });

// Log of product changes that aren't stored anywhere else: creation, edits
// (name/price/category/barcode/stock tracking), manual stock adjustments and
// deletion. Sales and returns come from the transactions/returns databases.
let historyDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/product_history.db",
  autoload: true,
});

historyDB.ensureIndex({ fieldName: "product_id" });

function logHistory(entries) {
  if (!entries.length) return;
  historyDB.insert(entries, function (err) {
    if (err) console.error("Failed to write product history:", err);
  });
}

function historyEntry(product, type, extra, who) {
  return Object.assign(
    {
      product_id: parseInt(product._id),
      product_name: product.name,
      type: type,
      user: (who && who.user) || "",
      user_id: (who && who.user_id) || "",
      date: new Date(),
    },
    extra
  );
}

// Compares a product before/after an edit and builds the history entries
function editHistoryEntries(before, after, who) {
  let entries = [];
  let tracked = after.stock == 1;

  let oldQty = parseInt(before.quantity) || 0;
  let newQty = parseInt(after.quantity) || 0;
  if (tracked && oldQty !== newQty) {
    entries.push(
      historyEntry(after, "stock_adjustment", {
        qty_change: newQty - oldQty,
        qty_before: oldQty,
        qty_after: newQty,
      }, who)
    );
  }

  let changes = [];
  [
    ["name", "Name"],
    ["price", "Price"],
    ["cost_price", "Cost price"],
    ["category", "Category"],
    ["barcode", "Barcode"],
  ].forEach(function (f) {
    if (String(before[f[0]] ?? "") !== String(after[f[0]] ?? "")) {
      changes.push({ field: f[0], label: f[1], from: before[f[0]], to: after[f[0]] });
    }
  });
  if ((before.stock == 1) !== tracked) {
    changes.push({
      field: "stock",
      label: "Stock tracking",
      from: before.stock == 1 ? "On" : "Off",
      to: tracked ? "On" : "Off",
    });
  }
  if (changes.length) {
    entries.push(historyEntry(after, "updated", { changes: changes }, who));
  }
  return entries;
}

app.getHistory = function (productId, callback) {
  let id = parseInt(productId);
  historyDB.find({ product_id: id }, callback);
};

app.get("/", function (req, res) {
  res.send("Inventory API");
});

app.get("/product/:productId", function (req, res) {
  if (!req.params.productId) {
    res.status(500).send("ID field is required.");
  } else {
    inventoryDB.findOne(
      {
        _id: parseInt(req.params.productId),
      },
      function (err, product) {
        res.send(product);
      }
    );
  }
});

app.get("/products", function (req, res) {
  inventoryDB.find({}, function (err, docs) {
    res.send(docs);
  });
});

app.post("/product", upload.single("imagename"), function (req, res) {
  // Selling price (required) and cost price (optional, "" = not set yet) must
  // be plain positive numbers: digits with an optional decimal part, no signs,
  // letters or symbols. The form checks this too; this guards the database.
  // Checked first, before any image is removed; a rejected save also discards
  // the picture uploaded with it.
  const PRICE_PATTERN = /^(\d+(\.\d{1,2})?|\d*\.\d{1,2})$/;
  let priceText = String(req.body.price ?? "").trim();
  let costText = String(req.body.cost_price ?? "").trim();
  function reject(message) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).send(message);
  }
  if (!PRICE_PATTERN.test(priceText)) {
    return reject("Selling price must be a positive number (e.g. 150 or 150.50).");
  }
  if (costText !== "" && !PRICE_PATTERN.test(costText)) {
    return reject("Cost price must be a positive number (e.g. 120 or 120.50).");
  }

  let image = "";

  if (req.body.img != "") {
    image = req.body.img;
  }

  if (req.file) {
    image = req.file.filename;
  }

  if (req.body.remove == 1) {
    const path = "./resources/app/public/uploads/product_image/" + req.body.img;
    try {
      fs.unlinkSync(path);
    } catch (err) {
      console.error(err);
    }

    if (!req.file) {
      image = "";
    }
  }

  let Product = {
    _id: parseInt(req.body.id),
    price: priceText.startsWith(".") ? "0" + priceText : priceText, // ".75" -> "0.75"
    cost_price: costText === "" ? "" : parseFloat(costText).toFixed(2),
    category: req.body.category,
    quantity: req.body.quantity == "" ? 0 : req.body.quantity,
    name: req.body.name,
    stock: req.body.stock == "on" ? 0 : 1,
    barcode: req.body.barcode ? req.body.barcode : parseInt(req.body.id),
    img: image,
  };

  let who = { user: req.body.history_user, user_id: req.body.history_user_id };

  if (req.body.id == "") {
    // Date.now() alone (or Date.now()/1000) can collide when products are
    // added in quick succession, which made nedb's unique _id index reject
    // the second insert and silently drop the new product while the UI
    // still reported success (the new barcode product ended up sharing the
    // stock/tile of the earlier one). Add a random suffix to keep IDs
    // unique even within the same millisecond.
    Product._id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    inventoryDB.insert(Product, function (err, product) {
      if (err) return res.status(500).send(err);
      logHistory([
        historyEntry(product, "created", {
          qty_change: product.stock == 1 ? parseInt(product.quantity) || 0 : 0,
          qty_before: 0,
          qty_after: product.stock == 1 ? parseInt(product.quantity) || 0 : null,
          price: product.price,
          cost_price: product.cost_price,
        }, who),
      ]);
      res.send(product);
    });
  } else {
    inventoryDB.findOne({ _id: parseInt(req.body.id) }, function (err, before) {
      inventoryDB.update(
        {
          _id: parseInt(req.body.id),
        },
        Product,
        {},
        function (err, numReplaced, product) {
          if (err) return res.status(500).send(err);
          if (before) logHistory(editHistoryEntries(before, Product, who));
          res.sendStatus(200);
        }
      );
    });
  }
});

app.delete("/product/:productId", function (req, res) {
  const img_path = process.env.APPDATA + "/POS/uploads/" + req.query.image_path;
  inventoryDB.findOne({ _id: parseInt(req.params.productId) }, function (err, product) {
    if (product) {
      logHistory([
        historyEntry(product, "deleted", {
          qty_before: product.stock == 1 ? parseInt(product.quantity) || 0 : null,
        }, { user: req.query.user, user_id: req.query.user_id }),
      ]);
    }
  });
  inventoryDB.remove(
    {
      _id: parseInt(req.params.productId),
    },
    function (err, numRemoved) {
      if (err) return res.status(500).send(err);
      fs.unlink(img_path, function (err) {
        if (err) {
          console.error(`Failed to delete image: ${img_path}`, err);
        }
        res.sendStatus(200);
      });
    }
  );
});

app.post("/product/sku", function (req, res) {
  var request = req.body;
  inventoryDB.findOne(
    {
      barcode: request.skuCode,
    },
    function (err, product) {
      res.send(product);
    }
  );
});

app.decrementInventory = function (products, callback) {
  async.eachSeries(
    products,
    function (transactionProduct, callback) {
      inventoryDB.findOne(
        {
          _id: parseInt(transactionProduct.id),
        },
        function (err, product) {
          if (!product || !product.quantity) {
            callback();
          } else {
            let updatedQuantity =
              parseInt(product.quantity) -
              parseInt(transactionProduct.quantity);

            inventoryDB.update(
              {
                _id: parseInt(product._id),
              },
              {
                $set: {
                  quantity: updatedQuantity,
                },
              },
              {},
              callback
            );
          }
        }
      );
    },
    function (err) {
      if (err) callback(err);
      else callback(null, "Inventory updated successfully.");
    }
  );
};

// ---- Goods received (GRN, see suppliers.js) ----

// the products with these ids (missing ones are simply not in the result)
app.getProductsByIds = function (ids, callback) {
  inventoryDB.find({ _id: { $in: ids.map((id) => parseInt(id)) } }, callback);
};

// Adds each received line to the product's stock and makes the line's unit
// cost the product's cost price. Every line is logged in the product history
// as a "grn" event.
// items: [{ product_id, quantity, unit_cost }]
// info: { grn_id, reference, supplier, payment_method, received_date,
//         user, user_id }
app.receiveGoods = function (items, info, callback) {
  async.eachSeries(
    items,
    function (item, next) {
      inventoryDB.findOne({ _id: parseInt(item.product_id) }, function (err, product) {
        if (err) return next(err);
        if (!product) return next(); // deleted meanwhile: nothing to add stock to

        let qtyBefore = parseInt(product.quantity) || 0;
        let qtyAfter = qtyBefore + item.quantity;
        let set = { quantity: qtyAfter };
        let costBefore = product.cost_price;
        let costAfter = Number(item.unit_cost).toFixed(2);
        let costChanged = String(costBefore ?? "") !== costAfter;
        if (costChanged) set.cost_price = costAfter;

        inventoryDB.update({ _id: product._id }, { $set: set }, {}, function (err) {
          if (err) return next(err);
          let extra = {
            qty_change: item.quantity,
            qty_before: qtyBefore,
            qty_after: qtyAfter,
            price: item.unit_cost,
            amount: Math.round(item.quantity * item.unit_cost * 100) / 100,
            reference: info.reference,
            grn_id: info.grn_id,
            supplier: info.supplier,
            payment_method: info.payment_method,
            received_date: info.received_date,
          };
          if (costChanged) {
            extra.cost_before = costBefore;
            extra.cost_after = costAfter;
          }
          logHistory([historyEntry(product, "grn", extra, { user: info.user, user_id: info.user_id })]);
          next();
        });
      });
    },
    callback
  );
};

app.incrementInventory = function (products, callback) {
  async.eachSeries(
    products,
    function (transactionProduct, callback) {
      inventoryDB.findOne(
        {
          _id: parseInt(transactionProduct.id),
        },
        function (err, product) {
          if (!product) {
            callback();
          } else {
            let updatedQuantity =
              parseInt(product.quantity || 0) +
              parseInt(transactionProduct.quantity);

            inventoryDB.update(
              {
                _id: parseInt(product._id),
              },
              {
                $set: {
                  quantity: updatedQuantity,
                },
              },
              {},
              callback
            );
          }
        }
      );
    },
    function (err) {
      if (err) callback(err);
      else callback(null, "Inventory updated successfully.");
    }
  );
};
