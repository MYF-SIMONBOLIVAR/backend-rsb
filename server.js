const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Brevo = require('@getbrevo/brevo');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN DE BREVO API ---
let apiInstance = new Brevo.TransactionalEmailsApi();
let apiKey = apiInstance.authentications['apiKey'];
apiKey.apiKey = process.env.BREVO_API_KEY;

// --- MIDDLEWARES ---
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// --- CONFIGURACIÓN DE CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.NAME,
  api_key:    process.env.KEY,
  api_secret: process.env.SECRET
});

// --- CONFIGURACIÓN DE ALMACENAMIENTO ---
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'cotizaciones_rsb',
    resource_type: 'raw', 
    access_control: [{ access_type: 'anonymous' }], 
    public_id: (req, file) => Date.now() + '-' + file.originalname.split('.')[0],
  },
});

const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 5 * 1024 * 1024 } 
});

// --- CONEXIÓN A BASE DE DATOS ---
const dbConfig = {
    host: '193.203.175.239',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    connectTimeout: 5000 // Solo 5 segundos de espera
};

// --- 1. CREAR SOLICITUD (POST) ---
app.post('/api/solicitudes', upload.single('cotizacion'), (req, res) => {
    try {
        const { responsable, correo, proveedor, nit, valor, descripcion, medioPago, centroCostos } = req.body;
        const archivoUrl = req.file ? req.file.path : null;

        const sql = `INSERT INTO solicitudes_compra 
        (responsable, correo, proveedor, nit, valor, descripcion, medio_pago, centro_costos, archivo_cotizacion) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [responsable, correo, proveedor, nit, valor, descripcion, medioPago, centroCostos, archivoUrl];

        db.query(sql, values, (err, result) => {
            if (err) {
                console.error("❌ Error MySQL:", err);
                return res.status(500).json({ error: err.message });
            }

            // --- NOTIFICACIÓN A TIC (Dentro del callback para tener las variables) ---
            const sendSmtpEmail = new Brevo.SendSmtpEmail();
            sendSmtpEmail.subject = `Nueva Solicitud de Compra: ${responsable} - ${proveedor}`;
            sendSmtpEmail.htmlContent = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #19287F; padding: 20px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 20px; text-transform: uppercase;">Portal de Solicitud de Compras</h1>
                    </div>
                    <div style="padding: 30px; line-height: 1.6;">
                        <p style="font-size: 16px;">Cordial saludo,</p>
                        <p>Se ha registrado una <b>nueva solicitud de compra</b> que requiere revisión:</p>
                        <div style="background-color: #f8fafc; border-radius: 6px; padding: 20px; margin: 20px 0; border-left: 4px solid #19287F;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr><td style="padding: 5px 0; color: #64748b;">RESPONSABLE:</td><td>${responsable}</td></tr>
                                <tr><td style="padding: 5px 0; color: #64748b;">PROVEEDOR:</td><td>${proveedor} (NIT: ${nit})</td></tr>
                                <tr><td style="padding: 5px 0; color: #64748b;">VALOR:</td><td style="color: #19287F; font-weight: bold;">$${Number(valor).toLocaleString()}</td></tr>
                                <tr><td style="padding: 5px 0; color: #64748b;">DESCRIPCIÓN:</td><td>${descripcion || 'N/A'}</td></tr>
                            </table>
                        </div>
                        <p style="text-align: center;">
                            <a href="https://compras.repuestossimonbolivar.com/admin" style="background-color: #19287F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">GESTIONAR SOLICITUD</a>
                        </p>
                    </div>
                </div>`;

            sendSmtpEmail.sender = { "name": "Sistema de Compras RSB", "email": "notificacionesticsimonbolivar@gmail.com" };
            sendSmtpEmail.to = [{ "email": "directoradministrativo@repuestossimonbolivar.com" }];

            apiInstance.sendTransacEmail(sendSmtpEmail).catch(e => console.error("Error Brevo:", e));

            res.status(200).json({ message: 'Solicitud enviada con éxito' });
        }); 
    } catch (error) {
        console.error("❌ Error Crítico:", error);
        res.status(500).json({ error: "Error interno" });
    }
});

// --- 2. LISTADO CON FILTROS (GET) ---
app.get('/api/solicitudes', (req, res) => {
    const connection = mysql.createConnection(dbConfig);

    connection.connect((err) => {
        if (err) {
            console.error("Error de red Hostinger:", err.code);
            return res.status(500).json({ error: "Servidor Hostinger no responde", detalle: err.code });
        }

        connection.query("SELECT * FROM solicitudes_compra ORDER BY id DESC", (qErr, results) => {
            connection.end(); // CERRAMOS INMEDIATAMENTE
            if (qErr) return res.status(500).json({ error: qErr.sqlMessage });
            res.json(results);
        });
    });
});

// --- 3. ACTUALIZAR ESTADO (PUT) ---
app.put('/api/solicitudes/:id', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    try {
        const [rows] = await db.promise().query("SELECT correo, responsable, proveedor, valor FROM solicitudes_compra WHERE id = ?", [id]);
        if (rows.length === 0) return res.status(404).json({ error: "No encontrada" });

        const { correo, responsable, proveedor, valor } = rows[0];
        await db.promise().query("UPDATE solicitudes_compra SET estado = ? WHERE id = ?", [estado, id]);

        const colorEstado = estado === 'Aprobado' ? '#2ecc71' : '#e74c3c';
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        
        sendSmtpEmail.subject = `Notificación de Solicitud: ${estado}`;
        sendSmtpEmail.htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
                <div style="background-color: ${colorEstado}; padding: 20px; text-align: center; color: white;">
                    <h2>Estado: ${estado}</h2>
                </div>
                <div style="padding: 20px;">
                    <p>Hola <b>${responsable}</b>,</p>
                    <p>Tu solicitud para <b>${proveedor}</b> por valor de <b>$${Number(valor).toLocaleString()}</b> ha sido <b>${estado}</b>.</p>
                </div>
            </div>`;

        sendSmtpEmail.sender = { "name": "Sistema RSB", "email": "notificacionesticsimonbolivar@gmail.com" };
        sendSmtpEmail.to = [{ "email": correo }];

        apiInstance.sendTransacEmail(sendSmtpEmail).catch(e => console.error("Error Brevo PUT:", e));

        res.json({ message: `Solicitud ${estado} correctamente.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 4. ESTADÍSTICAS (GET) ---
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

app.listen(PORT, () => {
    console.log(`🚀 Servidor RSB activo en puerto ${PORT}`);
});









































