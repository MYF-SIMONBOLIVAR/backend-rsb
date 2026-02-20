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
        sendSmtpEmail.subject = ` Nueva Solicitud de Compra: ${responsable} - ${proveedor}`;
        
        sendSmtpEmail.htmlContent = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #19287F; padding: 20px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 20px; text-transform: uppercase;">Portal de Solicitud de Compras </h1>
                </div>
                
                <div style="padding: 30px; line-height: 1.6;">
                    <p style="font-size: 16px;">Cordial saludo,</p>
                    <p>Se ha registrado una <b>nueva solicitud de compra</b> en el sistema que requiere su revisión y aprobación. A continuación, se detallan los puntos clave de la solicitud:</p>
                    
                    <div style="background-color: #f8fafc; border-radius: 6px; padding: 20px; margin: 20px 0; border: 1px left solid #19287F;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 5px 0; color: #64748b; font-size: 13px; text-transform: uppercase;"><b>Responsable:</b></td>
                                <td style="padding: 5px 0; font-size: 14px;">${responsable}</td>
                            </tr>
                            <tr>
                                <td style="padding: 5px 0; color: #64748b; font-size: 13px; text-transform: uppercase;"><b>Proveedor:</b></td>
                                <td style="padding: 5px 0; font-size: 14px;">${proveedor} (NIT: ${nit})</td>
                            </tr>
                            <tr>
                                <td style="padding: 5px 0; color: #64748b; font-size: 13px; text-transform: uppercase;"><b>Centro de Costos:</b></td>
                                <td style="padding: 5px 0; font-size: 14px;">${centroCostos || 'No especificado'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 5px 0; color: #64748b; font-size: 13px; text-transform: uppercase;"><b>Valor Total:</b></td>
                                <td style="padding: 5px 0; font-size: 18px; color: #19287F;"><b>$${Number(valor).toLocaleString()}</b></td>
                            </tr>
                        </table>
                    </div>

                    <p style="text-align: center; margin-top: 30px;">
                        <a href="https://compras.repuestossimonbolivar.com/admin" 
                           style="background-color: #19287F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; font-size: 14px;">
                           GESTIONAR SOLICITUD 
                        </a>
                    </p>
                </div>

                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 11px; color: #94a3b8;">
                    Este es un mensaje automático generado por el Sistema de Gestión de Compras de <b>Repuestos Simón Bolívar</b>. Por favor no responda a este correo.
                </div>
            </div>`;

        sendSmtpEmail.sender = { "name": "Sistema de Compras RSB", "email": "notificacionesticsimonbolivar@gmail.com" };
        sendSmtpEmail.to = [{ "email": "tic3@repuestossimonbolivar.com" }];

        apiInstance.sendTransacEmail(sendSmtpEmail).then(
            (data) => console.log("🚀 Correo profesional enviado:", data.messageId),
            (error) => console.error("❌ ERROR REAL DE BREVO:", error.response.body)
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
       sendSmtpEmail.subject = `${icono} Notificación de Solicitud: ${estado}`;

sendSmtpEmail.htmlContent = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: ${colorEstado}; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 20px; text-transform: uppercase;">Estado de su Solicitud</h1>
        </div>
        
        <div style="padding: 30px; line-height: 1.6;">
            <p style="font-size: 16px;">Cordial saludo, <b>${responsable}</b>.</p>
            <p>Le informamos que el proceso de revisión para su solicitud de compra ha finalizado. El estado actual es:</p>
            
            <div style="text-align: center; margin: 25px 0; padding: 20px; background-color: #f8fafc; border-radius: 10px; border: 2px dashed ${colorEstado};">
                <span style="font-size: 24px; font-weight: black; color: ${colorEstado}; text-transform: uppercase; letter-spacing: 2px;">
                    ${estado}
                </span>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 13px;"><b>PROVEEDOR:</b></td>
                    <td style="padding: 8px 0; font-size: 14px;">${proveedor}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 13px;"><b>ID SOLICITUD:</b></td>
                    <td style="padding: 8px 0; font-size: 14px;">#${id}</td>
                </tr>
            </table>

            <p style="font-size: 14px; color: #475569;">
                ${estado === 'Aprobado' 
                    ? 'Puede proceder con el trámite correspondiente según los lineamientos de la empresa.' 
                    : 'Si tiene dudas sobre esta decisión, por favor póngase en contacto con el departamento de Gestion Humana.'}
            </p>
        </div>

        <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
            Atentamente,<br>
            <b>Repuestos Simón Bolívar</b><br>
            Este correo es informativo, agradecemos no responder a esta dirección.
        </div>
    </div>`;

sendSmtpEmail.sender = { "name": "Sistema de Compras RSB", "email": "notificacionesticsimonbolivar@gmail.com" };
sendSmtpEmail.to = [{ "email": correo }];

apiInstance.sendTransacEmail(sendSmtpEmail).then(
    () => console.log(`✅ Notificación de ${estado} enviada a ${correo}`),
    (error) => console.error("❌ Error Brevo (PUT):", error.response ? error.response.body : error)
);

res.json({ message: `Solicitud ${estado} correctamente.` });

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


















