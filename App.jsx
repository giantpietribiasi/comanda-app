import React, { useState, useEffect, useMemo, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "./supabaseClient";

const CATEGORIES = ["Entradas", "Principales", "Postres", "Bebidas", "Otros"];
const UNITS = ["kg", "g", "l", "ml", "unid"];

const uid = () => Math.random().toString(36).slice(2, 10);
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const todayKey = (iso) => new Date(iso).toLocaleDateString("es-AR");

function seedData() {
  return {
    menuItems: [],
    orders: [],
    inventory: [],
    currentTicket: { items: [] },
    settings: { pin: null },
    users: [],
    activityLog: [],
  };
}

function normalize(parsed) {
  const base = seedData();
  return {
    ...base,
    ...parsed,
    currentTicket: parsed.currentTicket || { items: [] },
    settings: parsed.settings || { pin: null },
    menuItems: parsed.menuItems || [],
    orders: parsed.orders || [],
    inventory: parsed.inventory || [],
    users: parsed.users || [],
    activityLog: parsed.activityLog || [],
  };
}

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Work+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');";

function GlobalStyle() {
  return (
    <style>{`
      ${FONT_IMPORT}
      .rst-root {
        --bg-night: #1C1917;
        --bg-rail: #241F1C;
        --bg-card: #2C2622;
        --paper: #F3EEE2;
        --paper-dim: #E4DCC8;
        --amber: #D98E2B;
        --amber-dim: #8C5E1E;
        --ember: #C1432E;
        --sage: #7A9B6C;
        --ink: #F3EEE2;
        --ink-muted: #A89F91;
        --line: #3A332E;
        font-family: 'Work Sans', sans-serif;
        color: var(--ink);
        background: var(--bg-night);
        min-height: 100vh;
        width: 100%;
        box-sizing: border-box;
      }
      .rst-root *, .rst-root *::before, .rst-root *::after { box-sizing: border-box; }
      .rst-display { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.03em; }
      .rst-mono { font-family: 'IBM Plex Mono', monospace; }
      .rst-btn {
        font-family: 'Work Sans', sans-serif;
        font-weight: 500;
        border: 1px solid var(--line);
        background: transparent;
        color: var(--ink);
        border-radius: 4px;
        padding: 9px 16px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.15s ease;
      }
      .rst-btn:hover { border-color: var(--amber); color: var(--amber); }
      .rst-btn:active { transform: scale(0.97); }
      .rst-btn-primary { background: var(--amber); border-color: var(--amber); color: #241a08; }
      .rst-btn-primary:hover { background: #E8A33D; color: #241a08; }
      .rst-btn-danger { border-color: var(--ember); color: var(--ember); }
      .rst-btn-danger:hover { background: var(--ember); color: var(--paper); }
      .rst-input, .rst-select {
        font-family: 'Work Sans', sans-serif;
        background: var(--bg-night);
        border: 1px solid var(--line);
        color: var(--ink);
        border-radius: 4px;
        padding: 9px 10px;
        font-size: 14px;
        width: 100%;
      }
      .rst-input:focus, .rst-select:focus { outline: none; border-color: var(--amber); }
      .rst-ticket { background: var(--paper); color: #241f1a; border-radius: 2px; position: relative; }
      .rst-ticket-tear {
        height: 10px;
        width: 100%;
        background:
          linear-gradient(135deg, var(--bg-night) 50%, transparent 50%) 0 0,
          linear-gradient(45deg, var(--bg-night) 50%, transparent 50%) 0 0;
        background-size: 14px 14px;
        background-color: var(--paper);
        background-repeat: repeat-x;
      }
      .rst-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .rst-scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
      @media (max-width: 720px) {
        .rst-sidebar { display: none !important; }
        .rst-bottomnav { display: flex !important; }
        .rst-main { padding-bottom: 76px !important; margin-left: 0 !important; }
      }
      .print-area { display: none; }
      @media print {
        .rst-app-ui { display: none !important; }
        .print-area {
          display: block !important;
          width: 78mm;
          padding: 2mm 3mm;
          background: #fff;
          color: #000;
        }
      }
    `}</style>
  );
}

const NAV = [
  { id: "ticket", label: "Ticket", icon: "🧾" },
  { id: "menu", label: "Menú", icon: "📋" },
  { id: "inventario", label: "Inventario", icon: "📦" },
  { id: "caja", label: "Caja", icon: "💵" },
  { id: "reportes", label: "Reportes", icon: "📊" },
];

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState("ticket");
  const [toast, setToast] = useState(null);
  const [inventoryUnlocked, setInventoryUnlocked] = useState(false);
  const [printDoc, setPrintDoc] = useState(null);
  const [printQueue, setPrintQueue] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const lastWriteRef = useRef(0);

  // ---------- load + realtime sync ----------
  useEffect(() => {
    (async () => {
      const { data: row, error } = await supabase.from("app_data").select("data").eq("id", 1).single();
      if (error || !row) {
        setLoadError(true);
        setData(seedData());
        return;
      }
      setData(normalize(row.data || {}));
    })();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("app_data_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_data", filter: "id=eq.1" },
        (payload) => {
          // ignora el eco de nuestra propia escritura reciente
          if (Date.now() - lastWriteRef.current < 1200) return;
          if (payload.new && payload.new.data) {
            setData(normalize(payload.new.data));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ---------- printing ----------
  useEffect(() => {
    if (!printDoc) return;
    const t = setTimeout(() => window.print(), 60);
    const clear = () => setPrintDoc(null);
    window.addEventListener("afterprint", clear);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", clear);
    };
  }, [printDoc]);

  useEffect(() => {
    if (printDoc || printQueue.length === 0) return;
    const [next, ...rest] = printQueue;
    setPrintQueue(rest);
    setPrintDoc(next);
  }, [printDoc, printQueue]);

  function queuePrint(doc) {
    setPrintQueue((q) => [...q, doc]);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  async function persist(next) {
    setData(next);
    lastWriteRef.current = Date.now();
    try {
      const { error } = await supabase
        .from("app_data")
        .update({ data: next, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    } catch (e) {
      setToast("No se pudo guardar. Revisá tu conexión.");
    }
  }

  function logEntry(action, detail) {
    return {
      id: uid(),
      ts: new Date().toISOString(),
      user: currentUser ? currentUser.name : "Desconocido",
      action,
      detail,
    };
  }

  function withLog(nextData, entry) {
    return { ...nextData, activityLog: [entry, ...nextData.activityLog].slice(0, 200) };
  }

  if (!data) {
    return (
      <div className="rst-root" style={{ padding: 40, textAlign: "center" }}>
        <GlobalStyle />
        <p className="rst-mono" style={{ color: "var(--ink-muted)" }}>Cargando...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rst-root" style={{ padding: 40, maxWidth: 480, margin: "0 auto" }}>
        <GlobalStyle />
        <p className="rst-mono" style={{ color: "var(--ember)", fontSize: 13 }}>
          No se pudo conectar con la base de datos. Revisá que VITE_SUPABASE_URL y
          VITE_SUPABASE_ANON_KEY estén bien configuradas y que hayas corrido supabase-schema.sql.
        </p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <UserGate
        users={data.users}
        onSelect={setCurrentUser}
        onAddUser={(name) => {
          const newUser = { id: uid(), name };
          persist({ ...data, users: [...data.users, newUser] });
          setCurrentUser(newUser);
        }}
      />
    );
  }

  // ---------- ticket mutations ----------
  function addItemToTicket(menuItem) {
    const items = [...data.currentTicket.items];
    const existing = items.find((i) => i.menuItemId === menuItem.id);
    if (existing) {
      existing.qty += 1;
    } else {
      items.push({ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, qty: 1 });
    }
    persist({ ...data, currentTicket: { items } });
  }

  function changeQty(menuItemId, delta) {
    const items = data.currentTicket.items
      .map((i) => (i.menuItemId === menuItemId ? { ...i, qty: i.qty + delta } : i))
      .filter((i) => i.qty > 0);
    persist({ ...data, currentTicket: { items } });
  }

  function clearTicket() {
    persist({ ...data, currentTicket: { items: [] } });
  }

  function buildComandaDoc(items) {
    return { kind: "comanda", title: "COMANDA", time: new Date(), items: items.map((i) => ({ name: i.name, qty: i.qty })) };
  }

  function buildTicketDoc(order) {
    return {
      kind: "ticket",
      title: "TICKET",
      time: new Date(order.closedAt),
      items: order.items,
      total: order.total,
      paymentMethod: order.paymentMethod,
      cashReceived: order.cashReceived,
      change: order.change,
    };
  }

  function reprintTicket(order) {
    queuePrint(buildTicketDoc(order));
  }

  function checkout(paymentMethod, extra) {
    const items = data.currentTicket.items;
    if (items.length === 0) return;
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);

    const menuById = {};
    data.menuItems.forEach((m) => (menuById[m.id] = m));
    const deductions = {};
    items.forEach((soldItem) => {
      const menuItem = menuById[soldItem.menuItemId];
      if (menuItem && menuItem.recipe) {
        menuItem.recipe.forEach((r) => {
          deductions[r.inventoryId] = (deductions[r.inventoryId] || 0) + r.qty * soldItem.qty;
        });
      }
    });
    const inventory = data.inventory.map((inv) => {
      const d = deductions[inv.id];
      if (!d) return inv;
      return { ...inv, stock: +(inv.stock - d).toFixed(2) };
    });

    const order = {
      id: uid(),
      items,
      status: "cerrada",
      createdAt: new Date().toISOString(),
      closedAt: new Date().toISOString(),
      paymentMethod,
      total,
      cashReceived: extra?.cashReceived ?? null,
      change: extra?.change ?? null,
      user: currentUser.name,
    };

    const entry = logEntry("Cobró ticket", `${money(total)} — ${paymentMethod} — ${items.length} items`);
    persist(withLog({ ...data, orders: [...data.orders, order], inventory, currentTicket: { items: [] } }, entry));
    setToast("Ticket cobrado: " + money(total));
    queuePrint(buildComandaDoc(items));
    queuePrint(buildTicketDoc(order));
  }

  function setPin(pin) {
    const entry = logEntry("Cambió el PIN de inventario", "");
    persist(withLog({ ...data, settings: { ...data.settings, pin } }, entry));
  }

  function handleTabChange(next) {
    if (tab === "inventario" && next !== "inventario") setInventoryUnlocked(false);
    setTab(next);
  }

  function saveMenuItem(item) {
    const isNew = !item.id;
    let menuItems;
    if (item.id) {
      menuItems = data.menuItems.map((m) => (m.id === item.id ? item : m));
    } else {
      menuItems = [...data.menuItems, { ...item, id: uid() }];
    }
    const entry = logEntry(isNew ? "Creó plato" : "Editó plato", `${item.name} — ${money(item.price)}`);
    persist(withLog({ ...data, menuItems }, entry));
  }

  function deleteMenuItem(id) {
    const item = data.menuItems.find((m) => m.id === id);
    const entry = logEntry("Borró plato", item ? item.name : "");
    persist(withLog({ ...data, menuItems: data.menuItems.filter((m) => m.id !== id) }, entry));
  }

  function saveInventoryItem(item) {
    const isNew = !item.id;
    let inventory;
    if (item.id) {
      inventory = data.inventory.map((i) => (i.id === item.id ? item : i));
    } else {
      inventory = [...data.inventory, { ...item, id: uid() }];
    }
    const entry = logEntry(isNew ? "Creó insumo" : "Editó insumo", `${item.name} — ${item.stock} ${item.unit}`);
    persist(withLog({ ...data, inventory }, entry));
  }

  function adjustStock(id, delta) {
    const target = data.inventory.find((i) => i.id === id);
    const inventory = data.inventory.map((i) =>
      i.id === id ? { ...i, stock: Math.max(0, +(i.stock + delta).toFixed(2)) } : i
    );
    const updated = inventory.find((i) => i.id === id);
    const entry = logEntry(
      "Ajustó stock",
      target ? `${target.name}: ${delta > 0 ? "+" : ""}${delta} ${target.unit} (queda ${updated.stock})` : ""
    );
    persist(withLog({ ...data, inventory }, entry));
  }

  function deleteInventoryItem(id) {
    const item = data.inventory.find((i) => i.id === id);
    const entry = logEntry("Borró insumo", item ? item.name : "");
    persist(withLog({ ...data, inventory: data.inventory.filter((i) => i.id !== id) }, entry));
  }

  return (
    <div className="rst-root">
      <GlobalStyle />
      <div className="rst-app-ui" style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar tab={tab} setTab={handleTabChange} />
        <main className="rst-main" style={{ flex: 1, marginLeft: 200, padding: "28px 32px", maxWidth: 1100 }}>
          <Header tab={tab} currentUser={currentUser} onChangeUser={() => setCurrentUser(null)} />
          {tab === "ticket" && (
            <TicketView
              menuItems={data.menuItems}
              currentTicket={data.currentTicket}
              addItemToTicket={addItemToTicket}
              changeQty={changeQty}
              clearTicket={clearTicket}
              checkout={checkout}
            />
          )}
          {tab === "menu" && (
            <MenuView
              menuItems={data.menuItems}
              inventory={data.inventory}
              saveMenuItem={saveMenuItem}
              deleteMenuItem={deleteMenuItem}
            />
          )}
          {tab === "inventario" &&
            (!data.settings.pin ? (
              <PinSetupForm
                intro="Configurá un PIN para proteger el inventario. Te lo va a pedir cada vez que entrés a esta sección."
                onSet={(pin) => {
                  setPin(pin);
                  setInventoryUnlocked(true);
                }}
              />
            ) : !inventoryUnlocked ? (
              <PinUnlockForm pin={data.settings.pin} onUnlock={() => setInventoryUnlocked(true)} />
            ) : (
              <InventarioView
                inventory={data.inventory}
                saveInventoryItem={saveInventoryItem}
                adjustStock={adjustStock}
                deleteInventoryItem={deleteInventoryItem}
                onLock={() => setInventoryUnlocked(false)}
                onChangePin={setPin}
                activityLog={data.activityLog}
              />
            ))}
          {tab === "caja" && <CajaView orders={data.orders} onReprint={reprintTicket} />}
          {tab === "reportes" && <ReportesView orders={data.orders} />}
        </main>
      </div>
      <BottomNav tab={tab} setTab={handleTabChange} />
      {toast && <Toast text={toast} />}
      <PrintArea doc={printDoc} />
    </div>
  );
}

function UserGate({ users, onSelect, onAddUser }) {
  const [newName, setNewName] = useState("");
  return (
    <div className="rst-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <GlobalStyle />
      <div style={{ maxWidth: 340, width: "100%", padding: 24 }}>
        <div className="rst-display" style={{ fontSize: 32, color: "var(--amber)", textAlign: "center" }}>COMANDA</div>
        <p className="rst-mono" style={{ textAlign: "center", color: "var(--ink-muted)", fontSize: 13, marginBottom: 24 }}>
          ¿Quién está en el mostrador?
        </p>
        {users.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {users.map((u) => (
              <button key={u.id} className="rst-btn" onClick={() => onSelect(u)} style={{ textAlign: "left" }}>
                {u.name}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="rst-input"
            placeholder="Nombre nuevo"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                onAddUser(newName.trim());
                setNewName("");
              }
            }}
          />
          <button
            className="rst-btn rst-btn-primary"
            onClick={() => {
              if (newName.trim()) {
                onAddUser(newName.trim());
                setNewName("");
              }
            }}
          >
            Entrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Header({ tab, currentUser, onChangeUser }) {
  const item = NAV.find((n) => n.id === tab);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
      <div>
        <h1 className="rst-display" style={{ fontSize: 34, margin: 0, color: "var(--paper)" }}>{item.label}</h1>
        <div style={{ width: 40, height: 2, background: "var(--amber)", marginTop: 6 }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="rst-mono" style={{ fontSize: 12, color: "var(--ink-muted)" }}>{currentUser?.name}</span>
        <button className="rst-btn" style={{ fontSize: 11, padding: "5px 10px" }} onClick={onChangeUser}>
          Cambiar
        </button>
      </div>
    </div>
  );
}

function Sidebar({ tab, setTab }) {
  return (
    <nav
      className="rst-sidebar"
      style={{
        width: 200,
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        background: "var(--bg-rail)",
        borderRight: "1px solid var(--line)",
        padding: "24px 0",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "0 20px 24px", borderBottom: "1px solid var(--line)", marginBottom: 12 }}>
        <div className="rst-display" style={{ fontSize: 24, color: "var(--amber)" }}>COMANDA</div>
        <div className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>venta de mostrador</div>
      </div>
      {NAV.map((n) => (
        <button
          key={n.id}
          onClick={() => setTab(n.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 20px",
            background: tab === n.id ? "var(--bg-card)" : "transparent",
            borderLeft: tab === n.id ? "3px solid var(--amber)" : "3px solid transparent",
            color: tab === n.id ? "var(--paper)" : "var(--ink-muted)",
            border: "none",
            borderLeftWidth: 3,
            textAlign: "left",
            cursor: "pointer",
            fontFamily: "'Work Sans', sans-serif",
            fontSize: 14,
            fontWeight: tab === n.id ? 600 : 400,
          }}
        >
          <span>{n.icon}</span>
          {n.label}
        </button>
      ))}
    </nav>
  );
}

function BottomNav({ tab, setTab }) {
  return (
    <nav
      className="rst-bottomnav"
      style={{
        display: "none",
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "var(--bg-rail)",
        borderTop: "1px solid var(--line)",
        padding: "8px 4px",
        justifyContent: "space-around",
        zIndex: 20,
      }}
    >
      {NAV.map((n) => (
        <button
          key={n.id}
          onClick={() => setTab(n.id)}
          style={{
            background: "transparent",
            border: "none",
            color: tab === n.id ? "var(--amber)" : "var(--ink-muted)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            fontSize: 10,
            padding: "4px 6px",
            cursor: "pointer",
            fontFamily: "'Work Sans', sans-serif",
          }}
        >
          <span style={{ fontSize: 18 }}>{n.icon}</span>
          {n.label}
        </button>
      ))}
    </nav>
  );
}

function Toast({ text }) {
  return (
    <div
      className="rst-mono"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--paper)",
        color: "#241f1a",
        padding: "10px 18px",
        borderRadius: 4,
        fontSize: 13,
        zIndex: 50,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      {text}
    </div>
  );
}

function PrintArea({ doc }) {
  if (!doc) return <div className="print-area" />;
  return (
    <div className="print-area rst-mono" style={{ fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 16 }}>{doc.title}</div>
      <div style={{ textAlign: "center", fontSize: 10 }}>
        {doc.time.toLocaleDateString("es-AR")} {doc.time.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />
      {doc.items.map((it, idx) => (
        <div key={idx} style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{it.qty} x {it.name}</span>
          {doc.kind === "ticket" && <span>{money(it.price * it.qty)}</span>}
        </div>
      ))}
      {doc.kind === "ticket" && (
        <>
          <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <span>TOTAL</span>
            <span>{money(doc.total)}</span>
          </div>
          <div style={{ marginTop: 4 }}>Pago: {doc.paymentMethod}</div>
          {doc.paymentMethod === "Efectivo" && doc.cashReceived != null && (
            <>
              <div>Recibido: {money(doc.cashReceived)}</div>
              <div>Cambio: {money(doc.change)}</div>
            </>
          )}
        </>
      )}
      <div style={{ textAlign: "center", marginTop: 14, fontSize: 10 }}>
        {doc.kind === "comanda" ? "Para cocina" : "¡Gracias por su compra!"}
      </div>
    </div>
  );
}

function PinSetupForm({ intro, onSet, onCancel }) {
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");

  function submit() {
    if (pin1.length < 4) { setError("El PIN debe tener al menos 4 dígitos."); return; }
    if (pin1 !== pin2) { setError("Los PIN no coinciden."); return; }
    onSet(pin1);
  }

  return (
    <div style={{ maxWidth: 300 }}>
      {intro && <p className="rst-mono" style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 16 }}>{intro}</p>}
      <div style={{ marginBottom: 12 }}>
        <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>PIN (mínimo 4 dígitos)</label>
        <input className="rst-input" type="password" inputMode="numeric" value={pin1} onChange={(e) => setPin1(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>REPETIR PIN</label>
        <input className="rst-input" type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} />
      </div>
      {error && <p className="rst-mono" style={{ color: "var(--ember)", fontSize: 12, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="rst-btn rst-btn-primary" onClick={submit}>Guardar PIN</button>
        {onCancel && <button className="rst-btn" onClick={onCancel}>Cancelar</button>}
      </div>
    </div>
  );
}

function PinUnlockForm({ pin, onUnlock }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function submit() {
    if (value === pin) onUnlock();
    else { setError("PIN incorrecto."); setValue(""); }
  }

  return (
    <div style={{ maxWidth: 260 }}>
      <p className="rst-mono" style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 16 }}>
        Ingresá el PIN para acceder al inventario.
      </p>
      <input
        className="rst-input"
        type="password"
        inputMode="numeric"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ marginBottom: 10 }}
      />
      {error && <p className="rst-mono" style={{ color: "var(--ember)", fontSize: 12, marginBottom: 10 }}>{error}</p>}
      <button className="rst-btn rst-btn-primary" onClick={submit}>Desbloquear</button>
    </div>
  );
}

// ---------------- TICKET ----------------
function TicketView({ menuItems, currentTicket, addItemToTicket, changeQty, clearTicket, checkout }) {
  const [category, setCategory] = useState("Todos");
  const [payMethod, setPayMethod] = useState(null);
  const [cashReceived, setCashReceived] = useState("");
  const items = currentTicket.items;
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const filtered = menuItems.filter((m) => m.active !== false && (category === "Todos" || m.category === category));
  const change = cashReceived !== "" ? Number(cashReceived) - total : null;
  const canCharge = payMethod && (payMethod !== "Efectivo" || (cashReceived !== "" && Number(cashReceived) >= total));

  function handlePayMethod(p) {
    setPayMethod(p);
    if (p !== "Efectivo") setCashReceived("");
  }

  function handleCheckout() {
    if (!canCharge) return;
    const extra = payMethod === "Efectivo" ? { cashReceived: Number(cashReceived), change } : undefined;
    checkout(payMethod, extra);
    setPayMethod(null);
    setCashReceived("");
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {["Todos", ...CATEGORIES].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className="rst-btn"
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  background: category === c ? "var(--bg-card)" : "transparent",
                  borderColor: category === c ? "var(--amber)" : "var(--line)",
                  color: category === c ? "var(--amber)" : "var(--ink-muted)",
                }}
              >
                {c}
              </button>
            ))}
          </div>
          {menuItems.length === 0 && (
            <p className="rst-mono" style={{ color: "var(--ink-muted)", fontSize: 13 }}>
              Todavía no cargaste platos en el menú. Andá a la pestaña Menú para agregar.
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
            {filtered.map((m) => (
              <button key={m.id} onClick={() => addItemToTicket(m)} className="rst-btn" style={{ textAlign: "left", padding: "12px 14px" }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
                <div className="rst-mono" style={{ fontSize: 12, color: "var(--amber)", marginTop: 4 }}>{money(m.price)}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ width: 300, flexShrink: 0 }}>
          <div className="rst-ticket" style={{ padding: "18px 16px 14px" }}>
            <div className="rst-display" style={{ fontSize: 22, color: "#241f1a" }}>TICKET</div>
            <div className="rst-mono" style={{ fontSize: 10, color: "#6b6255", marginBottom: 10 }}>
              {new Date().toLocaleDateString("es-AR")} · {items.length} items
            </div>
            <div style={{ borderTop: "1px dashed #b8ae98", paddingTop: 10 }}>
              {items.length === 0 && (
                <p className="rst-mono" style={{ fontSize: 12, color: "#6b6255" }}>Sin items. Tocá un plato para agregarlo.</p>
              )}
              {items.map((i) => (
                <div key={i.menuItemId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div className="rst-mono" style={{ fontSize: 13 }}>{i.name}</div>
                    <div className="rst-mono" style={{ fontSize: 11, color: "#6b6255" }}>{money(i.price)} c/u</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => changeQty(i.menuItemId, -1)} style={{ width: 22, height: 22, border: "1px solid #b8ae98", background: "transparent", borderRadius: 3, cursor: "pointer" }}>−</button>
                    <span className="rst-mono" style={{ fontSize: 13, minWidth: 16, textAlign: "center" }}>{i.qty}</span>
                    <button onClick={() => changeQty(i.menuItemId, 1)} style={{ width: 22, height: 22, border: "1px solid #b8ae98", background: "transparent", borderRadius: 3, cursor: "pointer" }}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px dashed #b8ae98", marginTop: 8, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
              <span className="rst-mono" style={{ fontSize: 14, fontWeight: 500 }}>TOTAL</span>
              <span className="rst-mono" style={{ fontSize: 16, fontWeight: 500 }}>{money(total)}</span>
            </div>
          </div>
          <div className="rst-ticket-tear" />

          {items.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)", marginBottom: 8 }}>MEDIO DE PAGO</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {["Efectivo", "Tarjeta", "Transferencia"].map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePayMethod(p)}
                    className="rst-btn"
                    style={{
                      flex: 1,
                      fontSize: 12,
                      padding: "8px 4px",
                      background: payMethod === p ? "var(--bg-card)" : "transparent",
                      borderColor: payMethod === p ? "var(--amber)" : "var(--line)",
                      color: payMethod === p ? "var(--amber)" : "var(--ink-muted)",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {payMethod === "Efectivo" && (
                <div style={{ marginBottom: 12 }}>
                  <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>MONTO RECIBIDO</label>
                  <input
                    className="rst-input"
                    type="number"
                    autoFocus
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    placeholder={String(total)}
                  />
                  {cashReceived !== "" && (
                    <div
                      className="rst-mono"
                      style={{ fontSize: 13, marginTop: 6, color: change < 0 ? "var(--ember)" : "var(--sage)" }}
                    >
                      {change < 0 ? `Falta ${money(-change)}` : `Cambio: ${money(change)}`}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleCheckout}
                className="rst-btn rst-btn-primary"
                style={{ width: "100%", marginBottom: 8, opacity: canCharge ? 1 : 0.5 }}
              >
                Cobrar {money(total)}
              </button>
              <button onClick={clearTicket} className="rst-btn rst-btn-danger" style={{ width: "100%" }}>
                Cancelar ticket
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- MENU ----------------
function MenuView({ menuItems, inventory, saveMenuItem, deleteMenuItem }) {
  const [editing, setEditing] = useState(null);

  return (
    <div>
      <button className="rst-btn rst-btn-primary" onClick={() => setEditing({})} style={{ marginBottom: 20 }}>+ Nuevo plato</button>

      {editing && (
        <MenuItemForm
          item={editing}
          inventory={inventory}
          onSave={(item) => { saveMenuItem(item); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {menuItems.length === 0 ? (
        <p className="rst-mono" style={{ color: "var(--ink-muted)", fontSize: 13 }}>Todavía no hay platos cargados.</p>
      ) : (
        CATEGORIES.map((cat) => {
          const items = menuItems.filter((m) => m.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div className="rst-display" style={{ fontSize: 18, color: "var(--amber)", marginBottom: 8 }}>{cat.toUpperCase()}</div>
              {items.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14 }}>
                      {m.name} {m.active === false && <span style={{ color: "var(--ink-muted)", fontSize: 11 }}>(inactivo)</span>}
                    </div>
                    {m.recipe && m.recipe.length > 0 && (
                      <div className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 2 }}>receta: {m.recipe.length} insumo(s)</div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span className="rst-mono" style={{ color: "var(--amber)", fontSize: 14 }}>{money(m.price)}</span>
                    <button className="rst-btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setEditing(m)}>Editar</button>
                    <button className="rst-btn rst-btn-danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => deleteMenuItem(m.id)}>Borrar</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function MenuItemForm({ item, inventory, onSave, onCancel }) {
  const [name, setName] = useState(item.name || "");
  const [category, setCategory] = useState(item.category || CATEGORIES[0]);
  const [price, setPrice] = useState(item.price || "");
  const [active, setActive] = useState(item.active !== false);
  const [recipe, setRecipe] = useState((item.recipe || []).map((r) => ({ ...r, rowId: uid() })));
  const [error, setError] = useState("");

  function addRow() {
    if (inventory.length === 0) return;
    setRecipe([...recipe, { rowId: uid(), inventoryId: inventory[0].id, qty: "" }]);
  }
  function updateRow(rowId, field, value) {
    setRecipe(recipe.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
  }
  function removeRow(rowId) {
    setRecipe(recipe.filter((r) => r.rowId !== rowId));
  }

  function submit() {
    if (!name.trim()) { setError("Ingresá un nombre para el plato."); return; }
    if (!price || Number(price) <= 0) { setError("Ingresá un precio válido."); return; }
    const cleanRecipe = recipe.filter((r) => r.inventoryId && Number(r.qty) > 0).map((r) => ({ inventoryId: r.inventoryId, qty: Number(r.qty) }));
    onSave({ ...item, name: name.trim(), category, price: Number(price), active, recipe: cleanRecipe });
  }

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 6, padding: 18, marginBottom: 24, maxWidth: 460 }}>
      <div style={{ marginBottom: 12 }}>
        <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>NOMBRE</label>
        <input className="rst-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Milanesa napolitana" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>CATEGORÍA</label>
        <select className="rst-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>PRECIO</label>
        <input className="rst-input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="5500" />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Disponible en el menú
      </label>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginBottom: 14 }}>
        <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>RECETA (descuenta inventario al vender)</label>
        {inventory.length === 0 ? (
          <p className="rst-mono" style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 8 }}>Cargá insumos en Inventario primero para poder armar la receta.</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            {recipe.map((r) => {
              const invItem = inventory.find((i) => i.id === r.inventoryId);
              return (
                <div key={r.rowId} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                  <select className="rst-select" style={{ flex: 2 }} value={r.inventoryId} onChange={(e) => updateRow(r.rowId, "inventoryId", e.target.value)}>
                    {inventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <input className="rst-input" style={{ flex: 1 }} type="number" value={r.qty} onChange={(e) => updateRow(r.rowId, "qty", e.target.value)} placeholder={invItem ? invItem.unit : ""} />
                  <button onClick={() => removeRow(r.rowId)} style={{ background: "none", border: "none", color: "var(--ember)", cursor: "pointer", fontSize: 14 }}>✕</button>
                </div>
              );
            })}
            <button className="rst-btn" style={{ fontSize: 12, padding: "6px 12px", marginTop: 4 }} onClick={addRow}>+ Agregar insumo</button>
          </div>
        )}
      </div>

      {error && <p className="rst-mono" style={{ color: "var(--ember)", fontSize: 12, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="rst-btn rst-btn-primary" onClick={submit}>Guardar</button>
        <button className="rst-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ---------------- INVENTARIO ----------------
function InventarioView({ inventory, saveInventoryItem, adjustStock, deleteInventoryItem, onLock, onChangePin, activityLog }) {
  const [editing, setEditing] = useState(null);
  const [changingPin, setChangingPin] = useState(false);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}>
        <button className="rst-btn" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setChangingPin(true)}>Cambiar PIN</button>
        <button className="rst-btn" style={{ fontSize: 12, padding: "6px 12px" }} onClick={onLock}>🔒 Bloquear</button>
      </div>

      {changingPin && (
        <PinSetupForm
          intro="Elegí un nuevo PIN para el inventario."
          onSet={(pin) => { onChangePin(pin); setChangingPin(false); }}
          onCancel={() => setChangingPin(false)}
        />
      )}

      <button className="rst-btn rst-btn-primary" onClick={() => setEditing({})} style={{ marginBottom: 20 }}>+ Nuevo insumo</button>

      {editing && (
        <InventoryForm
          item={editing}
          onSave={(item) => { saveInventoryItem(item); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {inventory.length === 0 ? (
        <p className="rst-mono" style={{ color: "var(--ink-muted)", fontSize: 13 }}>Todavía no hay insumos cargados.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {inventory.map((i) => {
            const low = i.stock <= i.minStock;
            return (
              <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "var(--bg-card)", border: `1px solid ${low ? "var(--ember)" : "var(--line)"}`, borderRadius: 6, flexWrap: "wrap", gap: 10 }}>
                <div style={{ minWidth: 140 }}>
                  <div style={{ fontSize: 14 }}>{i.name}</div>
                  {low && <div className="rst-mono" style={{ fontSize: 11, color: "var(--ember)" }}>stock bajo</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => adjustStock(i.id, -1)} className="rst-btn" style={{ width: 28, height: 28, padding: 0 }}>−</button>
                  <span className="rst-mono" style={{ fontSize: 14, minWidth: 70, textAlign: "center" }}>{i.stock} {i.unit}</span>
                  <button onClick={() => adjustStock(i.id, 1)} className="rst-btn" style={{ width: 28, height: 28, padding: 0 }}>+</button>
                </div>
                <div className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>mín. {i.minStock} {i.unit}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="rst-btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setEditing(i)}>Editar</button>
                  <button className="rst-btn rst-btn-danger" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => deleteInventoryItem(i.id)}>Borrar</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 32, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
        <div className="rst-display" style={{ fontSize: 16, color: "var(--amber)", marginBottom: 10 }}>ACTIVIDAD RECIENTE</div>
        {activityLog.length === 0 ? (
          <p className="rst-mono" style={{ fontSize: 12, color: "var(--ink-muted)" }}>Sin movimientos registrados todavía.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activityLog.slice(0, 15).map((e) => (
              <div key={e.id} className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>
                  {new Date(e.ts).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} ·{" "}
                  <span style={{ color: "var(--paper)" }}>{e.user}</span> · {e.action}
                </span>
                <span>{e.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InventoryForm({ item, onSave, onCancel }) {
  const [name, setName] = useState(item.name || "");
  const [unit, setUnit] = useState(item.unit || UNITS[0]);
  const [stock, setStock] = useState(item.stock ?? "");
  const [minStock, setMinStock] = useState(item.minStock ?? "");
  const [error, setError] = useState("");

  function submit() {
    if (!name.trim()) { setError("Ingresá un nombre para el insumo."); return; }
    if (stock === "" || Number(stock) < 0) { setError("Ingresá una cantidad de stock válida."); return; }
    onSave({ ...item, name: name.trim(), unit, stock: Number(stock), minStock: Number(minStock) || 0 });
  }

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 6, padding: 18, marginBottom: 24, maxWidth: 420 }}>
      <div style={{ marginBottom: 12 }}>
        <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>NOMBRE</label>
        <input className="rst-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Harina 000" />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>STOCK ACTUAL</label>
          <input className="rst-input" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
        </div>
        <div style={{ width: 90 }}>
          <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>UNIDAD</label>
          <select className="rst-select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>STOCK MÍNIMO (alerta)</label>
        <input className="rst-input" type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
      </div>
      {error && <p className="rst-mono" style={{ color: "var(--ember)", fontSize: 12, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="rst-btn rst-btn-primary" onClick={submit}>Guardar</button>
        <button className="rst-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ---------------- CAJA ----------------
function CajaView({ orders, onReprint }) {
  const today = new Date().toLocaleDateString("es-AR");
  const todaySales = orders.filter((o) => o.status === "cerrada" && todayKey(o.closedAt) === today);
  const total = todaySales.reduce((s, o) => s + o.total, 0);
  const byMethod = todaySales.reduce((acc, o) => { acc[o.paymentMethod] = (acc[o.paymentMethod] || 0) + o.total; return acc; }, {});

  return (
    <div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 26 }}>
        <StatCard label="Ventas de hoy" value={money(total)} />
        <StatCard label="Tickets cobrados" value={todaySales.length} />
        {Object.entries(byMethod).map(([k, v]) => <StatCard key={k} label={k} value={money(v)} />)}
      </div>

      {todaySales.length === 0 ? (
        <p className="rst-mono" style={{ color: "var(--ink-muted)", fontSize: 13 }}>Todavía no cobraste ningún ticket hoy.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {todaySales.slice().sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt)).map((o) => (
            <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 6, flexWrap: "wrap", gap: 8 }} className="rst-mono">
              <span style={{ fontSize: 13 }}>
                {new Date(o.closedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {o.paymentMethod} · {o.user}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: "var(--amber)" }}>{money(o.total)}</span>
                <button onClick={() => onReprint(o)} className="rst-btn" style={{ fontSize: 11, padding: "4px 8px" }}>🖨</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 6, padding: "14px 18px", minWidth: 140 }}>
      <div className="rst-mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>{label.toUpperCase()}</div>
      <div className="rst-display" style={{ fontSize: 24, color: "var(--paper)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ---------------- REPORTES ----------------
function ReportesView({ orders }) {
  const closed = orders.filter((o) => o.status === "cerrada");

  const byDay = useMemo(() => {
    const map = {};
    closed.forEach((o) => { const k = todayKey(o.closedAt); map[k] = (map[k] || 0) + o.total; });
    return Object.entries(map).map(([day, total]) => ({ day, total })).slice(-14);
  }, [closed]);

  const topItems = useMemo(() => {
    const map = {};
    closed.forEach((o) => o.items.forEach((i) => { map[i.name] = (map[i.name] || 0) + i.qty; }));
    return Object.entries(map).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [closed]);

  const totalRevenue = closed.reduce((s, o) => s + o.total, 0);

  if (closed.length === 0) {
    return <p className="rst-mono" style={{ color: "var(--ink-muted)", fontSize: 13 }}>Todavía no hay ventas cerradas para mostrar reportes.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <StatCard label="Ingresos totales" value={money(totalRevenue)} />
        <StatCard label="Tickets cerrados" value={closed.length} />
        <StatCard label="Ticket promedio" value={money(totalRevenue / closed.length)} />
      </div>

      <div className="rst-display" style={{ fontSize: 18, color: "var(--amber)", marginBottom: 10 }}>VENTAS POR DÍA</div>
      <div style={{ width: "100%", height: 220, marginBottom: 30 }}>
        <ResponsiveContainer>
          <BarChart data={byDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="day" stroke="var(--ink-muted)" fontSize={11} />
            <YAxis stroke="var(--ink-muted)" fontSize={11} />
            <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--line)", fontSize: 12 }} formatter={(v) => money(v)} />
            <Bar dataKey="total" fill="var(--amber)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rst-display" style={{ fontSize: 18, color: "var(--amber)", marginBottom: 10 }}>PLATOS MÁS VENDIDOS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {topItems.map((i) => (
          <div key={i.name} style={{ display: "flex", justifyContent: "space-between", padding: "9px 14px", background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 6 }}>
            <span style={{ fontSize: 13 }}>{i.name}</span>
            <span className="rst-mono" style={{ fontSize: 13, color: "var(--amber)" }}>{i.qty} vendidos</span>
          </div>
        ))}
      </div>
    </div>
  );
}
