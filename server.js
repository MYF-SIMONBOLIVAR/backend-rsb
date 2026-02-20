const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Brevo = require('@getbrevo/brevo');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DE BREVO API ---
let apiInstance = new Brevo.TransactionalEmailsApi();
let apiKey = apiInstance.authentications['apiKey'];

// Ahora leemos la clave desde las variables de entorno de Render
apiKey.apiKey = process.env.BREVO_API_KEY;

// --- MIDDLEWARES ---
app.use(cors({
    origin: '*', // Permitir acceso desde cualquier origen para evitar bloqueos CORS
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- CONFIGURACIÓN DE ALMACENAMIENTO (MULTER) ---
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir); }

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

// --- CONEXIÓN A BASE DE DATOS ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10
});

// --- RUTAS DEL API ---

// 1. CREAR SOLICITUD (POST)
app.post('/api/solicitudes', upload.single('cotizacion'), (req, res) => {
    const { responsable, correo, proveedor, nit, valor, medioPago, centroCostos } = req.body;
    const archivo = req.file ? req.file.filename : null;

    const sql = `INSERT INTO solicitudes_compra 
    (responsable, correo, proveedor, nit, valor, medio_pago, centro_costos, archivo_cotizacion) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [responsable, correo, proveedor, nit, valor, medioPago, centroCostos, archivo];

    db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        // NOTIFICACIÓN A TIC (Aviso de nueva solicitud)
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.subject = `🚨 Nueva Solicitud: ${responsable} - ${proveedor}`;
        sendSmtpEmail.htmlContent = `
            <div style="font-family: sans-serif; padding: 20px; border-top: 5px solid #19287F;">
                <h2 style="color: #19287F;">Nueva Solicitud Recibida</h2>
                <p><b>Responsable:</b> ${responsable}</p>
                <p><b>Proveedor:</b> ${proveedor}</p>
                <p><b>Valor:</b> $${Number(valor).toLocaleString()}</p>
                <a href="https://backend-rsb.onrender.com/admin" style="background:#19287F; color:white; padding:10px; text-decoration:none; border-radius:5px;">Gestionar Solicitud</a>
            </div>`;
        sendSmtpEmail.sender = { "name": "Simon Bolivar", "email": "notificacionesticsimonbolivar@gmail.com" };
        sendSmtpEmail.to = [{ "email": "tic3@repuestossimonbolivar.com" }];

        apiInstance.sendTransacEmail(sendSmtpEmail).then(
            () => console.log("🚀 Aviso enviado a TIC"),
            (error) => console.error("❌ Error Brevo (POST):", error)
        );

        res.status(200).json({ message: 'Solicitud enviada exitosamente.' });
    });
});

// 2. LISTADO CON FILTROS (GET)
app.get('/api/solicitudes', (req, res) => {
    const { inicio, fin, medio, proveedor, estado } = req.query;
    let sql = "SELECT * FROM solicitudes_compra WHERE 1=1";
    const values = [];

    if (inicio && fin) {
        sql += " AND fecha_creacion BETWEEN ? AND ?";
        values.push(`${inicio} 00:00:00`, `${fin} 23:59:59`);
    }
    if (medio) { sql += " AND medio_pago = ?"; values.push(medio); }
    if (proveedor) {
        sql += " AND (proveedor LIKE ? OR responsable LIKE ?)";
        values.push(`%${proveedor}%`, `%${proveedor}%`);
    }
    if (estado) { sql += " AND estado = ?"; values.push(estado); }

    sql += " ORDER BY FIELD(estado, 'Pendiente', 'Aprobado', 'Rechazado'), fecha_creacion DESC";

    db.query(sql, values, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. ACTUALIZAR ESTADO (PUT)
app.put('/api/solicitudes/:id', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    try {
        const [rows] = await db.promise().query("SELECT correo, responsable, proveedor FROM solicitudes_compra WHERE id = ?", [id]);
        if (rows.length === 0) return res.status(404).json({ error: "No encontrado" });

        const { correo, responsable, proveedor } = rows[0];
        await db.promise().query("UPDATE solicitudes_compra SET estado = ? WHERE id = ?", [estado, id]);

        // NOTIFICACIÓN AL EMPLEADO VÍA BREVO
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.subject = `Notificación: Solicitud de Compra ${estado}`;
        sendSmtpEmail.htmlContent = `
            <div style="font-family: Arial, sans-serif; border-top: 6px solid ${estado === 'Aprobado' ? '#2ecc71' : '#e74c3c'}; padding: 20px;">
                <h2 style="color: #19287F;">Estado de su Solicitud</h2>
                <p>Hola <b>${responsable}</b>,</p>
                <p>Su solicitud para <b>${proveedor}</b> ha sido:</p>
                <h1 style="color: ${estado === 'Aprobado' ? '#2ecc71' : '#e74c3c'};">${estado.toUpperCase()}</h1>
                <p style="font-size: 12px; color: #666;">Mensaje automático del Portal RSB.</p>
            </div>`;
        sendSmtpEmail.sender = { "name": "Simon Bolivar", "email": "notificacionesticsimonbolivar@gmail.com" };
        sendSmtpEmail.to = [{ "email": correo }];

        apiInstance.sendTransacEmail(sendSmtpEmail).then(
            () => console.log(`✅ Notificación enviada a ${correo}`),
            (error) => console.error("❌ Error Brevo (PUT):", error)
        );

        res.json({ message: `Solicitud ${estado} correctamente.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. ESTADÍSTICAS (GET)
app.get('/api/stats', (req, res) => {
    const sql = `
        SELECT 
            COUNT(CASE WHEN estado = 'Pendiente' THEN 1 END) as pendientes,
            COUNT(CASE WHEN estado = 'Aprobado' THEN 1 END) as aprobadas,
            COUNT(CASE WHEN estado = 'Rechazado' THEN 1 END) as rechazadas,
            SUM(CASE WHEN estado = 'Aprobado' THEN valor ELSE 0 END) as valorTotal,
            SUM(CASE WHEN estado = 'Pendiente' THEN valor ELSE 0 END) as valorPendiente
        FROM solicitudes_compra`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor RSB activo en puerto ${PORT}`);
});















