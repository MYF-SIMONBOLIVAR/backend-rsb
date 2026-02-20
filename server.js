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

// --- CONFIGURACIÓN DE ALMACENAMIENTO (MULTER + CLOUDINARY) ---
// --- CONFIGURACIÓN DE ALMACENAMIENTO CORREGIDA ---
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'cotizaciones_rsb',
    // Cambiamos 'raw' por 'image' para que Cloudinary lo trate como asset estándar
    resource_type: 'image', 
    format: async (req, file) => 'pdf', 
    public_id: (req, file) => Date.now() + '-' + file.originalname.split('.')[0],
  },
});

// AQUÍ CORREGIDO: Solo una declaración de 'upload'
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 5 * 1024 * 1024 } 
});;

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

// A. CREAR SOLICITUD
app.post('/api/solicitudes', upload.single('cotizacion'), (req, res) => {
    try {
        const { responsable, correo, proveedor, nit, valor, medioPago, centroCostos } = req.body;
        const archivoUrl = req.file ? req.file.path : null;

        const sql = `INSERT INTO solicitudes_compra 
        (responsable, correo, proveedor, nit, valor, medio_pago, centro_costos, archivo_cotizacion) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [responsable, correo, proveedor, nit, valor, medioPago, centroCostos, archivoUrl];

        db.query(sql, values, (err, result) => {
            if (err) {
                console.error("❌ Error MySQL:", err.message);
                return res.status(500).json({ error: "Error en base de datos" });
            }

            // Notificación a TIC
            const sendSmtpEmail = new Brevo.SendSmtpEmail();
            sendSmtpEmail.subject = `🚨 Nueva Solicitud: ${responsable} - ${proveedor}`;
            sendSmtpEmail.htmlContent = `
                <div style="font-family: sans-serif; padding: 20px; border-top: 5px solid #19287F;">
                    <h2>Nueva Solicitud de Compra</h2>
                    <p><b>Responsable:</b> ${responsable}</p>
                    <p><b>Proveedor:</b> ${proveedor}</p>
                    <p><b>Valor:</b> $${Number(valor).toLocaleString()}</p>
                    <br>
                    <a href="https://compras.repuestossimonbolivar.com/admin" style="background:#19287F; color:white; padding:10px; text-decoration:none; border-radius:5px;">GESTIONAR PANEL</a>
                    ${archivoUrl ? `<a href="${archivoUrl}" style="background:#e2e8f0; color:#19287F; padding:10px; text-decoration:none; border-radius:5px; margin-left:10px;">VER ADJUNTO</a>` : ''}
                </div>`;
            
            sendSmtpEmail.sender = { "name": "Sistema RSB", "email": "notificacionesticsimonbolivar@gmail.com" };
            sendSmtpEmail.to = [{ "email": "tic3@repuestossimonbolivar.com" }];

            apiInstance.sendTransacEmail(sendSmtpEmail).catch(e => console.error("Error Brevo:", e));

            res.status(200).json({ message: 'Solicitud enviada' });
        });
    } catch (error) {
        console.error("❌ Error Crítico:", error);
        res.status(500).json({ error: "Error interno" });
    }
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

// 3. ACTUALIZAR ESTADO (APROBAR/RECHAZAR DESDE ADMIN.HTML)
app.put('/api/solicitudes/:id', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    console.log(`--- Iniciando actualización ID: ${id} a estado: ${estado} ---`);

    try {
        // A. Buscar los datos necesarios del solicitante
        const [rows] = await db.promise().query(
            "SELECT correo, responsable, proveedor FROM solicitudes_compra WHERE id = ?", 
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "No se encontró la solicitud" });
        }

        const { correo, responsable, proveedor } = rows[0];

        // B. Actualizar el estado en la base de datos
        await db.promise().query(
            "UPDATE solicitudes_compra SET estado = ? WHERE id = ?", 
            [estado, id]
        );

        // C. Definir variables visuales para el correo
        const colorEstado = estado === 'Aprobado' ? '#2ecc71' : '#e74c3c';
        const icono = estado === 'Aprobado' ? '✅' : '❌';

        // D. Configurar y enviar notificación vía Brevo
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        
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
                        <span style="font-size: 24px; font-weight: bold; color: ${colorEstado}; text-transform: uppercase; letter-spacing: 2px;">
                            ${estado}
                        </span>
                    </div>

                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 13px;"><b>PROVEEDOR:</b></td>
                            <td style="padding: 8px 0; font-size: 14px;">${proveedor}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; font-size: 13px;"><b>VALOR SOLICITADO:</b></td>
                            <td style="padding: 8px 0; font-size: 16px; color: #19287F;"><b>$${Number(valor).toLocaleString()}</b></td>
                        </tr>
                    </table>

                    <p style="font-size: 14px; color: #475569;">
                        ${estado === 'Aprobado' 
                            ? 'Puede proceder con el trámite correspondiente según los lineamientos de la empresa.' 
                            : 'Si tiene dudas sobre esta decisión, por favor póngase en contacto con el departamento de <b>Gestión Humana</b>.'}
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

        // Envío asíncrono
        apiInstance.sendTransacEmail(sendSmtpEmail).then(
            () => console.log(`✅ Notificación de ${estado} enviada a ${correo}`),
            (error) => console.error("❌ Error Brevo (PUT):", error.response ? error.response.body : error)
        );

        // E. Responder al cliente
        res.json({ message: `Solicitud ${estado} correctamente.` });

    } catch (error) {
        console.error("❌ Error en el proceso PUT:", error);
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
































