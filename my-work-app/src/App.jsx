import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import "./App.css";

const STORAGE_KEY = "repairLogs";
const DARK_KEY = "darkMode";
const DB_NAME = "RepairLogPhotoDB";
const DB_VERSION = 1;
const PHOTO_STORE = "photos";

function openPhotoDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePhotoToDB(id, photoData) {
  const db = await openPhotoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).put(photoData, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getPhotoFromDB(id) {
  const db = await openPhotoDB();

  return new Promise((resolve, reject) => {
    const request = db
      .transaction(PHOTO_STORE, "readonly")
      .objectStore(PHOTO_STORE)
      .get(id);

    request.onsuccess = () => resolve(request.result || "");
    request.onerror = () => reject(request.error);
  });
}

async function deletePhotoFromDB(id) {
  const db = await openPhotoDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function safeJSONParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function makeId() {
  return crypto.randomUUID();
}

function formatDate(value) {
  if (!value) return new Date().toLocaleString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function formatNowISO() {
  return new Date().toISOString();
}

function toDateTimeLocal(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);

  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value) {
  if (!value) return formatNowISO();
  return new Date(value).toISOString();
}

function exportDownload(data, filename, type = "application/json") {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

export default function App() {
  const [activeTab, setActiveTab] = useState("new");
  const [repairs, setRepairs] = useState([]);
  const [photoMap, setPhotoMap] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");

  const [form, setForm] = useState({
    barcode: "",
    property: "",
    unit: "",
    machineType: "Washer",
    notes: "",
  });

  const [photoPreview, setPhotoPreview] = useState("");
  const [photoFileData, setPhotoFileData] = useState("");
  const [search, setSearch] = useState("");
  const [darkMode, setDarkMode] = useState(true);

  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  const [selectedRepair, setSelectedRepair] = useState(null);
  const [editingRepair, setEditingRepair] = useState(null);

  const [editForm, setEditForm] = useState({
    barcode: "",
    property: "",
    unit: "",
    machineType: "Washer",
    notes: "",
  });

  const [editDate, setEditDate] = useState("");

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const importInputRef = useRef(null);
  const fullRestoreInputRef = useRef(null);
  const scannerRef = useRef(null);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(""), 2200);
  }

  useEffect(() => {
    const stored = safeJSONParse(localStorage.getItem(STORAGE_KEY), []);

    const migrated = stored.map((repair) => ({
      ...repair,
      dateISO: repair.dateISO || repair.date || formatNowISO(),
    }));

    setRepairs(migrated);
    setDarkMode(safeJSONParse(localStorage.getItem(DARK_KEY), true));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      const cleanRepairs = repairs.map(({ photo, ...repair }) => repair);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanRepairs));
    }
  }, [repairs, loaded]);

  useEffect(() => {
    localStorage.setItem(DARK_KEY, JSON.stringify(darkMode));
  }, [darkMode]);

  useEffect(() => {
    async function loadPhotos() {
      const nextMap = {};

      for (const repair of repairs) {
        if (repair.photoId) {
          const photo = await getPhotoFromDB(repair.photoId);
          if (photo) nextMap[repair.id] = photo;
        }
      }

      setPhotoMap(nextMap);
    }

    repairs.length ? loadPhotos() : setPhotoMap({});
  }, [repairs]);

  const previousRepairs = useMemo(() => {
    const currentBarcode = form.barcode.trim().toLowerCase();
    if (!currentBarcode) return [];

    return repairs.filter(
      (repair) => repair.barcode?.trim().toLowerCase() === currentBarcode
    );
  }, [form.barcode, repairs]);

  useEffect(() => {
    if (!form.barcode.trim() || previousRepairs.length === 0) return;

    const last = previousRepairs[0];

    setForm((current) => ({
      ...current,
      property: current.property || last.property || "",
      unit: current.unit || last.unit || "",
      machineType: last.machineType || current.machineType,
    }));
  }, [form.barcode, previousRepairs]);

  const filteredRepairs = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return repairs;

    return repairs.filter((repair) =>
      [
        repair.barcode,
        repair.property,
        repair.unit,
        repair.machineType,
        repair.notes,
        repair.date,
        repair.dateISO,
        repair.editedDate,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [repairs, search]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateEditForm(field, value) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch {}

      scannerRef.current = null;
    }

    setScanning(false);
    setScanMessage("");
  }

  async function startScanner() {
    if (scanning) {
      await stopScanner();
      return;
    }

    setScanning(true);
    setScanMessage("Point camera at barcode...");

    setTimeout(async () => {
      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 15,
            qrbox: { width: 320, height: 160 },
            aspectRatio: 1.777,
            formatsToSupport: [
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.ITF,
              Html5QrcodeSupportedFormats.QR_CODE,
              Html5QrcodeSupportedFormats.DATA_MATRIX,
            ],
          },
          async (decodedText) => {
            updateForm("barcode", decodedText);
            setScanMessage("Scanned successfully!");
            if (navigator.vibrate) navigator.vibrate(150);

            try {
              await scanner.stop();
              await scanner.clear();
            } catch {}

            scannerRef.current = null;

            setTimeout(() => {
              setScanning(false);
              setScanMessage("");
            }, 700);
          }
        );
      } catch {
        showToast("Camera error. Use manual entry.");
        setScanning(false);
        setScanMessage("");
        scannerRef.current = null;
      }
    }, 100);
  }

  function clearForm() {
    setForm({
      barcode: "",
      property: "",
      unit: "",
      machineType: "Washer",
      notes: "",
    });
    setPhotoPreview("");
    setPhotoFileData("");
  }

  async function saveRepair() {
    if (!form.barcode.trim()) {
      showToast("Scan or enter a barcode first.");
      return;
    }

    const id = makeId();
    const photoId = photoFileData ? `photo-${id}` : "";
    const dateISO = formatNowISO();

    if (photoFileData) await savePhotoToDB(photoId, photoFileData);

    const entry = {
      id,
      barcode: form.barcode.trim(),
      property: form.property.trim(),
      unit: form.unit.trim(),
      machineType: form.machineType,
      notes: form.notes.trim(),
      photoId,
      dateISO,
      date: formatDate(dateISO),
    };

    setRepairs((current) => [entry, ...current]);

    if (photoFileData) {
      setPhotoMap((current) => ({ ...current, [id]: photoFileData }));
    }

    clearForm();
    showToast("Repair saved.");
  }

  async function deleteRepair(repair) {
    if (!confirm("Delete this repair?")) return;

    if (repair.photoId) await deletePhotoFromDB(repair.photoId);

    setRepairs((current) => current.filter((item) => item.id !== repair.id));

    setPhotoMap((current) => {
      const copy = { ...current };
      delete copy[repair.id];
      return copy;
    });

    setSelectedRepair(null);
    showToast("Repair deleted.");
  }

  function openEdit(repair) {
    const dateValue = repair.dateISO || repair.date;

    setEditingRepair(repair);
    setEditForm({
      barcode: repair.barcode || "",
      property: repair.property || "",
      unit: repair.unit || "",
      machineType: repair.machineType || "Washer",
      notes: repair.notes || "",
    });
    setEditDate(toDateTimeLocal(dateValue));
    setSelectedRepair(null);
  }

  function saveEdit() {
    if (!editForm.barcode.trim()) {
      showToast("Barcode cannot be blank.");
      return;
    }

    const newDateISO = fromDateTimeLocal(editDate);

    setRepairs((current) =>
      current.map((repair) =>
        repair.id === editingRepair.id
          ? {
              ...repair,
              barcode: editForm.barcode.trim(),
              property: editForm.property.trim(),
              unit: editForm.unit.trim(),
              machineType: editForm.machineType,
              notes: editForm.notes.trim(),
              dateISO: newDateISO,
              date: formatDate(newDateISO),
              editedDate: formatDate(formatNowISO()),
            }
          : repair
      )
    );

    setEditingRepair(null);
    showToast("Repair updated.");
  }

  function exportBasicBackup() {
    exportDownload(
      JSON.stringify(repairs, null, 2),
      "repair-log-basic-backup.json"
    );
    showToast("Basic backup exported.");
  }

  async function exportFullBackup() {
    const photos = {};

    for (const repair of repairs) {
      if (repair.photoId) {
        const photo = await getPhotoFromDB(repair.photoId);
        if (photo) photos[repair.photoId] = photo;
      }
    }

    const backup = {
      version: 1,
      exportedAt: formatDate(formatNowISO()),
      repairs,
      photos,
    };

    exportDownload(
      JSON.stringify(backup, null, 2),
      "repair-log-full-backup-with-photos.json"
    );

    showToast("Full backup exported.");
  }

  function restoreFullBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const backup = JSON.parse(reader.result);

        if (!Array.isArray(backup.repairs) || !backup.photos) {
          showToast("Invalid full backup file.");
          return;
        }

        if (
          !confirm(
            "Restore full backup? This will replace all current repairs and photos."
          )
        ) {
          return;
        }

        for (const repair of repairs) {
          if (repair.photoId) await deletePhotoFromDB(repair.photoId);
        }

        for (const [photoId, photoData] of Object.entries(backup.photos)) {
          await savePhotoToDB(photoId, photoData);
        }

        setRepairs(backup.repairs);
        setPhotoMap({});
        showToast("Full backup restored.");
      } catch {
        showToast("Could not restore backup.");
      }
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  function exportCSV() {
    const headers = [
      "Date",
      "Edited Date",
      "Barcode",
      "Type",
      "Property",
      "Unit",
      "Notes",
    ];

    const rows = repairs.map((repair) =>
      [
        repair.date,
        repair.editedDate,
        repair.barcode,
        repair.machineType,
        repair.property,
        repair.unit,
        repair.notes,
      ]
        .map((item) => `"${String(item || "").replaceAll('"', '""')}"`)
        .join(",")
    );

    exportDownload(
      [headers.join(","), ...rows].join("\n"),
      "repair-log.csv",
      "text/csv"
    );

    showToast("CSV exported.");
  }

  function importBasicBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);

        if (!Array.isArray(imported)) {
          showToast("Invalid backup file.");
          return;
        }

        if (
          confirm(
            "Import this backup? This will add the backup entries to your current list."
          )
        ) {
          setRepairs((current) => [...imported, ...current]);
          showToast("Backup imported.");
        }
      } catch {
        showToast("Could not read backup file.");
      }
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  function handlePhoto(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      setPhotoPreview(reader.result);
      setPhotoFileData(reader.result);
      showToast("Photo added.");
    };

    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function RepairCard({ repair }) {
    return (
      <article className="repair-card">
        <div className="repair-card-top">
          <div>
            <span className="repair-type-pill">{repair.machineType}</span>
            <h3>{repair.barcode}</h3>
          </div>

          <button className="dots-btn" onClick={() => setSelectedRepair(repair)}>
            ⋯
          </button>
        </div>

        <p className="repair-location">
          {repair.property || "No property"}
          {repair.unit && ` • Unit ${repair.unit}`}
        </p>

        <p className="repair-date">{repair.date}</p>

        {repair.editedDate && (
          <p className="edited">Edited: {repair.editedDate}</p>
        )}

        {repair.notes && <p className="repair-notes">{repair.notes}</p>}

        {photoMap[repair.id] && (
          <img className="repair-photo" src={photoMap[repair.id]} alt="Repair" />
        )}
      </article>
    );
  }

  function ActionSheets() {
    return (
      <>
        {selectedRepair && (
          <div className="modal-backdrop" onClick={() => setSelectedRepair(null)}>
            <div className="modal action-sheet" onClick={(e) => e.stopPropagation()}>
              <h2>Repair Options</h2>

              <button onClick={() => openEdit(selectedRepair)}>Edit Repair</button>

              <button className="delete" onClick={() => deleteRepair(selectedRepair)}>
                Delete Repair
              </button>

              <button className="cancel-btn" onClick={() => setSelectedRepair(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {editingRepair && (
          <div className="modal-backdrop">
            <div className="modal edit-modal">
              <h2>Edit Repair</h2>

              <label>
                Barcode
                <input
                  value={editForm.barcode}
                  onChange={(event) =>
                    updateEditForm("barcode", event.target.value)
                  }
                />
              </label>

              <label>
                Property
                <input
                  value={editForm.property}
                  onChange={(event) =>
                    updateEditForm("property", event.target.value)
                  }
                />
              </label>

              <label>
                Unit
                <input
                  value={editForm.unit}
                  onChange={(event) => updateEditForm("unit", event.target.value)}
                />
              </label>

              <label>
                Machine Type
                <select
                  value={editForm.machineType}
                  onChange={(event) =>
                    updateEditForm("machineType", event.target.value)
                  }
                >
                  <option>Washer</option>
                  <option>Dryer</option>
                </select>
              </label>

              <label>
                Date & Time
                <input
                  type="datetime-local"
                  value={editDate}
                  onChange={(event) => setEditDate(event.target.value)}
                />
              </label>

              <label>
                Repair Notes
                <textarea
                  value={editForm.notes}
                  onChange={(event) =>
                    updateEditForm("notes", event.target.value)
                  }
                />
              </label>

              <button className="save-btn" onClick={saveEdit}>
                Save Changes
              </button>

              <button className="cancel-btn" onClick={() => setEditingRepair(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  function Toast() {
    if (!toast) return null;
    return <div className="toast">{toast}</div>;
  }

  function NewRepairPage() {
    return (
      <>
        <header className="top-bar">
          <div>
            <h1>New Repair</h1>
            <p>Scan, document, and save service work.</p>
          </div>

          <button className="small-btn" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? "Light" : "Dark"}
          </button>
        </header>

        <section className="hero-card">
          <button className="scan-btn" onClick={startScanner}>
            {scanning ? "Stop Scanning" : "Scan Barcode"}
          </button>

          {scanning && <div id="reader"></div>}
          {scanMessage && <p className="scan-message">{scanMessage}</p>}
        </section>

        <section className="card">
          <div className="section-title">
            <span>01</span>
            <h2>Machine Info</h2>
          </div>

          <label>
            Barcode
            <input
              value={form.barcode}
              onChange={(event) => updateForm("barcode", event.target.value)}
              placeholder="Scan or type barcode"
            />
          </label>

          <label>
            Machine Type
            <select
              value={form.machineType}
              onChange={(event) => updateForm("machineType", event.target.value)}
            >
              <option>Washer</option>
              <option>Dryer</option>
            </select>
          </label>

          {previousRepairs.length > 0 && (
            <div className="previous-box">
              <h3>Previous Repairs Found</h3>
              <p>
                This machine has {previousRepairs.length} previous repair
                {previousRepairs.length === 1 ? "" : "s"}.
              </p>

              {previousRepairs.slice(0, 3).map((repair) => (
                <div className="previous-repair" key={repair.id}>
                  <strong>{repair.date}</strong>
                  <p>
                    {repair.machineType}
                    {repair.property && ` • ${repair.property}`}
                    {repair.unit && ` • Unit ${repair.unit}`}
                  </p>
                  {repair.notes && <p>{repair.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="section-title">
            <span>02</span>
            <h2>Location</h2>
          </div>

          <label>
            Property
            <input
              value={form.property}
              onChange={(event) => updateForm("property", event.target.value)}
              placeholder="Example: Oak Ridge Apartments"
            />
          </label>

          <label>
            Unit
            <input
              value={form.unit}
              onChange={(event) => updateForm("unit", event.target.value)}
              placeholder="Example: 204B"
            />
          </label>
        </section>

        <section className="card">
          <div className="section-title">
            <span>03</span>
            <h2>Repair Details</h2>
          </div>

          <label>
            Repair Notes
            <textarea
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Example: Replaced drain pump, cleaned lint chute, tested cycle..."
            />
          </label>
        </section>

        <section className="card">
          <div className="section-title">
            <span>04</span>
            <h2>Photos</h2>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            hidden
          />

          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhoto}
            hidden
          />

          <div className="button-grid">
            <button onClick={() => cameraInputRef.current.click()}>
              Take Photo
            </button>

            <button
              className="secondary-btn"
              onClick={() => galleryInputRef.current.click()}
            >
              Choose Photo
            </button>
          </div>

          {photoPreview && (
            <img className="preview" src={photoPreview} alt="Repair preview" />
          )}
        </section>

        <section className="card save-panel">
          <div className="button-grid">
            <button className="secondary-btn" onClick={clearForm}>
              Clear
            </button>

            <button className="save-btn" onClick={saveRepair}>
              Save Repair
            </button>
          </div>
        </section>
      </>
    );
  }

  function HistoryPage() {
    return (
      <>
        <header className="top-bar">
          <div>
            <h1>History</h1>
            <p>{repairs.length} saved repairs</p>
          </div>
        </header>

        <section className="card">
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search barcode, property, unit, notes..."
          />

          <p className="count">
            Showing {filteredRepairs.length} of {repairs.length} repairs
          </p>
        </section>

        {filteredRepairs.length === 0 && (
          <section className="empty-state">
            <h2>No repairs found</h2>
            <p>Try a different search or save a new repair.</p>
          </section>
        )}

        {filteredRepairs.map((repair) => (
          <RepairCard repair={repair} key={repair.id} />
        ))}
      </>
    );
  }

  function BackupPage() {
  return (
    <>
      <header className="top-bar">
        <div>
          <h1>Backup</h1>
          <p>Protect your repair logs and photos.</p>
        </div>
      </header>

      <section className="card">
        <div className="section-title">
          <span>Safe</span>
          <h2>Full Backup</h2>
        </div>

        <p className="helper-text">
          Use this before updating the app. This backup includes repairs and photos.
        </p>

        <button onClick={exportFullBackup}>
          Export FULL Backup With Photos
        </button>

        <input
          ref={fullRestoreInputRef}
          type="file"
          accept="application/json"
          onChange={restoreFullBackup}
          hidden
        />

        <button
          className="secondary-btn"
          onClick={() => fullRestoreInputRef.current.click()}
        >
          Restore FULL Backup With Photos
        </button>
      </section>

      <section className="card">
        <div className="section-title">
          <span>CSV</span>
          <h2>Export Report</h2>
        </div>

        <p className="helper-text">
          Export a spreadsheet-style file without photos.
        </p>

        <button onClick={exportCSV}>Export CSV</button>
      </section>

      <section className="card">
        <div className="section-title">
          <span>JSON</span>
          <h2>Basic Backup</h2>
        </div>

        <p className="helper-text">
          Basic backup does not include photos.
        </p>

        <button onClick={exportBasicBackup}>
          Export Basic Backup JSON
        </button>

        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          onChange={importBasicBackup}
          hidden
        />

        <button
          className="secondary-btn"
          onClick={() => importInputRef.current.click()}
        >
          Import Basic Backup JSON
        </button>
      </section>
    </>
  );
}

  function SettingsPage() {
    return (
      <>
        <header className="top-bar">
          <div>
            <h1>Settings</h1>
            <p>Customize and manage the app.</p>
          </div>
        </header>

        <section className="card settings-row">
          <div>
            <h2>Appearance</h2>
            <p className="helper-text">Switch between dark and light mode.</p>
          </div>

          <button className="small-btn" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? "Light" : "Dark"}
          </button>
        </section>

        <section className="card">
          <h2>App Info</h2>
          <p className="helper-text">
            Repair Log saves repair text in local storage and photos in
            IndexedDB on this device.
          </p>
        </section>
      </>
    );
  }

  return (
    <main className={darkMode ? "app dark" : "app"}>
      <div className="page-content">
        {activeTab === "new" && <NewRepairPage />}
        {activeTab === "history" && <HistoryPage />}
        {activeTab === "backup" && <BackupPage />}
        {activeTab === "settings" && <SettingsPage />}
      </div>

      <nav className="tab-bar">
        <button
          className={activeTab === "new" ? "tab active" : "tab"}
          onClick={() => setActiveTab("new")}
        >
          <span>＋</span>
          New
        </button>

        <button
          className={activeTab === "history" ? "tab active" : "tab"}
          onClick={() => setActiveTab("history")}
        >
          <span>⌕</span>
          History
        </button>

        <button
          className={activeTab === "backup" ? "tab active" : "tab"}
          onClick={() => setActiveTab("backup")}
        >
          <span>⇪</span>
          Backup
        </button>

        <button
          className={activeTab === "settings" ? "tab active" : "tab"}
          onClick={() => setActiveTab("settings")}
        >
          <span>⚙</span>
          Settings
        </button>
      </nav>

      <ActionSheets />
      <Toast />
    </main>
  );
}