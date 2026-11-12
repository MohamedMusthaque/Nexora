const app = require("express")();
const Datastore = require("nedb");

// This is deliberately a small, independent store.  The audit trail must not
// prevent a sale or stock operation from completing if its own file is busy.
const auditDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/user_history.db",
  autoload: true,
});

auditDB.ensureIndex({ fieldName: "created_at" });
auditDB.ensureIndex({ fieldName: "user_id" });

function text(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max || 140);
}

function value(body, keys) {
  body = body || {};
  for (let i = 0; i < keys.length; i++) {
    if (body[keys[i]] != null && body[keys[i]] !== "") return body[keys[i]];
  }
  return "";
}

function itemCount(body) {
  return Array.isArray(body && body.items) ? body.items.length : 0;
}

function responseObject(body) {
  if (body && typeof body === "object") return body;
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch (e) { return {}; }
  }
  return {};
}

function documentReference(path, body, response) {
  const saved = responseObject(response);
  const id = function() { return saved._id || body._id || body.id || ""; };
  const ref = function(type, value, label) {
    return value === "" || value == null ? null : { type: type, id: value, label: label || "" };
  };

  if (path === "/api/new") return ref("invoice", id(), saved.order || body.order || saved.ref_number || body.ref_number);
  if (path === "/api/returns") return ref("invoice", body.order_id, body.order_ref || "");
  if (path === "/api/adjustments") return ref("adjustment", id(), saved.adj_no);
  if (path === "/api/suppliers/grn") return ref("grn", id(), saved.grn_no);
  if (path === "/api/suppliers/prn") return ref("prn", id(), saved.prn_no);
  if (path === "/api/transfers") return ref("transfer", id(), saved.transfer_no);
  if (path === "/api/inventory/product") return ref("product", id(), saved.name || body.name);
  if (/^\/api\/inventory\/product\/\d+$/.test(path) && saved.deleted_product) {
    return {
      type: "deleted-product",
      id: saved.deleted_product._id,
      label: saved.deleted_product.name || "",
      snapshot: saved.deleted_product,
    };
  }
  return null;
}

function activityFor(req, originalPath, response) {
  const path = String(originalPath || req.path).replace(/\/$/, "") || "/";
  const method = req.method;
  const body = req.body || {};
  const id = path.split("/").filter(Boolean).pop();
  const named = (label, fields) => {
    const name = text(value(body, fields), 80);
    return name ? label + ": " + name : "";
  };

  // Sales and customer money
  if (path === "/api/new") {
    const bill = text(value(body, ["order", "ref_number", "_id"]), 60);
    const count = itemCount(body);
    return {
      module: "Billing",
      action: method === "POST" ? "Created bill" : "Updated bill",
      details: [bill && "Bill " + bill, count && count + " item" + (count === 1 ? "" : "s"), body.payment_type].filter(Boolean).join(" · "),
    };
  }
  if (path === "/api/delete") return { module: "Billing", action: "Deleted held bill", details: text(value(body, ["orderId"]), 60) };
  if (path === "/api/returns") return { module: "Billing", action: body.type === "exchange" ? "Created exchange" : "Created return", details: itemCount(body) + " item" + (itemCount(body) === 1 ? "" : "s") };
  if (path === "/api/credit-payments") return { module: "Customers", action: "Recorded credit payment", details: named("Customer", ["customer_name", "customer"]) };

  // Products and stock
  if (path === "/api/adjustments") {
    return { module: "Stock", action: "Adjusted stock", details: [body.direction === "in" ? "Stock in" : "Stock out", body.reason, itemCount(body) + " product" + (itemCount(body) === 1 ? "" : "s")].filter(Boolean).join(" · ") };
  }
  if (path === "/api/inventory/product") {
    return { module: "Products", action: body.id ? "Updated product" : "Created product", details: named("Product", ["name", "sku", "barcode"]) };
  }
  if (/^\/api\/inventory\/product\/\d+$/.test(path) && method === "DELETE") {
    const product = responseObject(response).deleted_product || {};
    const name = text(product.name, 100);
    const variant = [text(product.brand, 50), text(product.size, 40)].filter(Boolean).join(" ");
    const code = text(product.sku || product.barcode, 60);
    return {
      module: "Products",
      action: "Deleted product",
      details: [name || "Product #" + id, variant, code && "Code: " + code].filter(Boolean).join(" · "),
    };
  }
  if (path === "/api/inventory/product/sku") return { module: "Products", action: "Updated product SKU", details: named("SKU", ["sku", "barcode"]) };
  if (path === "/api/inventory/brands") return { module: "Products", action: "Created brand", details: named("Brand", ["name"]) };
  if (path === "/api/inventory/brands/rename") return { module: "Products", action: "Renamed brand", details: [body.from, body.to].filter(Boolean).join(" → ") };
  if (/^\/api\/inventory\/brands\//.test(path) && method === "DELETE") return { module: "Products", action: "Deleted brand", details: "Brand #" + id };
  if (path === "/api/inventory/units") return { module: "Products", action: "Created unit", details: named("Unit", ["name"]) };
  if (path === "/api/inventory/units/rename") return { module: "Products", action: "Renamed unit", details: [body.from, body.to].filter(Boolean).join(" → ") };
  if (/^\/api\/inventory\/units\//.test(path) && method === "DELETE") return { module: "Products", action: "Deleted unit", details: "Unit #" + id };

  // Customers, suppliers and expenses
  if (path === "/api/customers/customer") return { module: "Customers", action: method === "POST" ? "Created customer" : "Updated customer", details: named("Customer", ["name", "fullname", "phone"]) };
  if (/^\/api\/customers\/customer\//.test(path) && method === "DELETE") return { module: "Customers", action: "Deleted customer", details: "Customer #" + id };
  if (path === "/api/suppliers/supplier") return { module: "Suppliers", action: "Created supplier", details: named("Supplier", ["name", "supplier_name"]) };
  if (/^\/api\/suppliers\/supplier\//.test(path)) return { module: "Suppliers", action: method === "DELETE" ? "Deleted supplier" : "Updated supplier", details: named("Supplier", ["name", "supplier_name"]) || "Supplier #" + id };
  if (path === "/api/suppliers/grn") return { module: "Stock", action: "Created goods received note", details: itemCount(body) + " product" + (itemCount(body) === 1 ? "" : "s") };
  if (path === "/api/suppliers/prn") return { module: "Stock", action: "Created purchase return note", details: itemCount(body) + " product" + (itemCount(body) === 1 ? "" : "s") };
  if (path === "/api/suppliers/payments") return { module: "Suppliers", action: "Recorded supplier payment", details: named("Supplier", ["supplier_name", "supplier"]) };
  if (path === "/api/expenses") return { module: "Expenses", action: method === "POST" ? "Created expense" : "Updated expense", details: named("Expense", ["description", "amount"]) };
  if (/^\/api\/expenses\/\d+$/.test(path) && method === "DELETE") return { module: "Expenses", action: "Deleted expense", details: "Expense #" + id };
  if (path === "/api/expenses/types") return { module: "Expenses", action: "Created expense type", details: named("Type", ["name"]) };
  if (/^\/api\/expenses\/types\//.test(path)) return { module: "Expenses", action: method === "DELETE" ? "Deleted expense type" : "Updated expense type", details: named("Type", ["name"]) || "Type #" + id };

  // Administration
  if (path === "/api/categories/category") return { module: "Products", action: method === "POST" ? "Created category" : "Updated category", details: named("Category", ["name"]) };
  if (/^\/api\/categories\/category\//.test(path) && method === "DELETE") return { module: "Products", action: "Deleted category", details: "Category #" + id };
  if (path === "/api/users/post") return { module: "Users", action: body.id ? "Updated user" : "Created user", details: named("User", ["fullname", "username"]) };
  if (/^\/api\/users\/user\//.test(path) && method === "DELETE") return { module: "Users", action: "Deleted user", details: "User #" + id };
  if (path === "/api/users/setup") return { module: "Users", action: "Created administrator", details: named("User", ["fullname", "username"]) };
  if (path === "/api/users/login") return { module: "Session", action: "Signed in", details: text(value(body, ["username"]), 80) };
  if (/^\/api\/users\/logout\//.test(path)) return { module: "Session", action: "Signed out", details: "" };
  if (path === "/api/settings/post") return { module: "Settings", action: "Updated settings", details: "Store, receipt or payment settings" };
  if (path === "/api/transfers") return { module: "Accounts", action: "Transferred money", details: [body.from_method, body.to_method].filter(Boolean).join(" → ") };

  return { module: "System", action: method === "DELETE" ? "Deleted record" : method === "PUT" ? "Updated record" : "Created record", details: path.replace("/api/", "") };
}

// Mounted before the APIs. Log only successful changes, after their response
// has completed, so failed validation and cancelled operations are never shown.
app.capture = function(req, res, next) {
  // This endpoint happens to use POST for a read-only report lookup.
  const readOnlyPost = req.path === "/api/returns/for-orders";
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(req.method) || readOnlyPost || req.path.indexOf("/api/user-history") === 0) return next();
  // Routers temporarily trim req.url while handling nested APIs. Keep the
  // original top-level route; req.body itself stays live for multipart forms.
  const originalPath = req.path;
  let responseBody;
  const send = res.send;
  res.send = function(body) {
    responseBody = body;
    return send.call(this, body);
  };
  res.on("finish", function() {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const activity = activityFor(req, originalPath, responseBody);
    const actorId = text(req.get("X-User-Id"), 60);
    const actorName = text(req.get("X-User-Name"), 100) || (activity.action === "Signed in" ? text(value(req.body, ["username"]), 100) : "System");
    auditDB.insert({
      created_at: new Date().toJSON(),
      user_id: actorId,
      user: actorName,
      module: activity.module,
      action: activity.action,
      details: text(activity.details, 180),
      reference: documentReference(originalPath, req.body || {}, responseBody),
      method: req.method,
      route: originalPath,
    }, function(err) {
      if (err) console.error("Could not write user history:", err);
    });
  });
  next();
};

app.get("/", function(req, res) {
  const query = {};
  if (req.query.user) query.user_id = String(req.query.user);
  if (req.query.module) query.module = String(req.query.module);
  auditDB.find(query).sort({ created_at: -1 }).limit(2000).exec(function(err, events) {
    if (err) return res.status(500).send("Could not load the user history.");
    res.send(events || []);
  });
});

module.exports = app;
