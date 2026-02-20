const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const app = express();
const PORT = 3000;
const Brevo = require('@getbrevo/brevo');
const sendSmtpEmail = new Brevo.SendSmtpEmail();

// Configuración de la API
let apiInstance = new Brevo.TransactionalEmailsApi();
let apiKey = apiInstance.authentications['apiKey'];
apiKey.apiKey = 'xsmtpsib-5aa5906bbc787e056a664f726bf56d3b911fb2444ffbe946d79e3d304db2e0f8-R9j49Uo9nXmeIiaB';

// 1. MIDDLEWARES
app.use(cors({
    origin: 'https://compras.repuestossimonbolivar.com', // Tu subdominio de Hostinger
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());
// Servir la carpeta uploads como estática para poder ver los PDFs/Imágenes desde el navegador
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 465,               // CAMBIO: de 587 a 465
    secure: true,            // CAMBIO: de false a true (Obligatorio para el 465)
    auth: {
        user: 'a290d3001@smtp-brevo.com',
        pass: 'xsmtpsib-5aa5906bbc787e056a664f726bf56d3b911fb2444ffbe946d79e3d304db2e0f8-R9j49Uo9nXmeIiaB'
    },
    tls: {
        rejectUnauthorized: false 
    }
});

// Definimos los destinatarios como un solo string (IMPORTANTE)
const DESTINATARIOS = "tic3@repuestossimonbolivar.com"
// Verifica la conexión del correo al iniciar el servidor
transporter.verify(function(error, success) {
  if (error) {
    console.log(" Error en la configuración de correo: ", error);
  } else {
    console.log(" El servidor de correo está listo para enviar notificaciones");
  }
});

// 2. CONFIGURACIÓN DE ALMACENAMIENTO (MULTER)
// Crea la carpeta uploads si no existe
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Nombre único: timestamp + nombre original
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Límite de 5MB
});

// 3. CONEXIÓN A BASE DE DATOS (MySQL Local)
const db = mysql.createPool({ // <-- Cambia a 'createPool'
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Verificamos la conexión inicial
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error conectando a MySQL:', err.message);
        return;
    }
    console.log(' Conectado a la base de datos MySQL (vía Pool)');
    connection.release(); // Devolvemos la conexión al pool
});

// 4. RUTAS DEL API
// A. Crear nueva solicitud (Desde index.html)

sendSmtpEmail.subject = `🚨 Nueva Solicitud: ${responsable} - ${proveedor}`;
sendSmtpEmail.htmlContent = `... tu HTML ...`;

// Usamos el formato de objeto puro para evitar errores de sintaxis en el string
sendSmtpEmail.sender = { 
    "name": "Simon Bolivar", // Usa el nombre exacto que aparece en tu captura de Brevo
    "email": "notificacionesticsimonbolivar@gmail.com" 
};

sendSmtpEmail.to = [{ "email": "tic3@repuestossimonbolivar.com" }];

// Ejecutar envío
apiInstance.sendTransacEmail(sendSmtpEmail).then(function(data) {
    console.log("🚀 API de Brevo respondió éxito:", data.messageId);
}, function(error) {
    // ESTO ES CLAVE: Si falla, aquí veremos el porqué real
    console.error("❌ ERROR DETALLADO DE BREVO:", error.response.body);
});
// B. Obtener todas las solicitudes pendientes (Para admin.html)

app.get('/api/solicitudes', (req, res) => {
    // Añadimos 'estado' a la desestructuración de req.query
    const { inicio, fin, medio, proveedor, estado } = req.query;
    
    let sql = "SELECT * FROM solicitudes_compra WHERE 1=1";
    const values = [];

    if (inicio && fin) {
        sql += " AND fecha_creacion BETWEEN ? AND ?";
        values.push(`${inicio} 00:00:00`, `${fin} 23:59:59`);
    }
    if (medio) {
        sql += " AND medio_pago = ?";
        values.push(medio);
    }
    if (proveedor) {
        sql += " AND (proveedor LIKE ? OR responsable LIKE ?)";
        values.push(`%${proveedor}%`, `%${proveedor}%`);
    }
    
    // NUEVO: Filtro por estado
    if (estado) {
        sql += " AND estado = ?";
        values.push(estado);
    }

    // Mantenemos tu orden jerárquico (Pendientes primero)
    sql += " ORDER BY FIELD(estado, 'Pendiente', 'Aprobado', 'Rechazado'), fecha_creacion DESC";

    db.query(sql, values, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});
// C. Actualizar estado (Aprobar/Rechazar desde admin.html)
app.put('/api/solicitudes/:id', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    console.log(`--- 1. Recibida actualización para ID: ${id} a ${estado} ---`);

    try {
        // A. Buscar el correo del solicitante antes de actualizar
        const [rows] = await db.promise().query(
            "SELECT correo, responsable, proveedor FROM solicitudes_compra WHERE id = ?", 
            [id]
        );

        if (rows.length === 0) {
            console.log("--- ❌ Error: No se encontró el ID en la BD ---");
            return res.status(404).json({ error: "No se encontró la solicitud" });
        }

        const { correo, responsable, proveedor } = rows[0];
        console.log(`--- 2. Datos encontrados: ${responsable} (${correo}) ---`);

        // B. Actualizar el estado en la base de datos
        await db.promise().query(
            "UPDATE solicitudes_compra SET estado = ? WHERE id = ?", 
            [estado, id]
        );
        console.log("--- 3. Base de datos actualizada con éxito ---");

        // C. Configurar el correo de notificación
        const mailOptions = {
            from: '"Portal RSB" <notificacionesticsimonbolivar@gmail.com>',
            to: correo, // Correo recuperado de la BD
            subject: `Notificación: Solicitud de Compra ${estado}`,
            html: `
                <div style="font-family: Arial, sans-serif; border-top: 6px solid ${estado === 'Aprobado' ? '#2ecc71' : '#e74c3c'}; padding: 20px; background-color: #f8fafc;">
                    <h2 style="color: #19287F;">Estado de su Solicitud</h2>
                    <p>Hola <b>${responsable}</b>,</p>
                    <p>Le informamos que su solicitud para el proveedor <b>${proveedor}</b> ha sido:</p>
                    <h1 style="color: ${estado === 'Aprobado' ? '#2ecc71' : '#e74c3c'}; text-transform: uppercase;">${estado}</h1>
                    <hr style="border: 0; border-top: 1px solid #ddd;">
                    <p style="font-size: 12px; color: #666;">Este es un mensaje automático del Portal de Compras RSB.</p>
                </div>
            `
        };

        // D. Enviar el correo
        console.log("--- 4. Intentando enviar correo de notificación... ---");
        
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log("--- ❌ 5. Error enviando correo:", error.message);
            } else {
                console.log("--- ✅ 5. CORREO ENVIADO EXITOSAMENTE ---");
                console.log("Respuesta de Gmail:", info.response);
            }
        });

        // E. Responder al administrador
        res.json({ message: `Solicitud ${estado} correctamente y correo enviado.` });

    } catch (error) {
        console.error("--- ❌ ERROR CRÍTICO EN EL PROCESO ---", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.get('/api/stats', (req, res) => {
    const sql = `
        SELECT 
            COUNT(CASE WHEN estado = 'Pendiente' THEN 1 END) as pendientes,
            COUNT(CASE WHEN estado = 'Aprobado' THEN 1 END) as aprobadas,
            COUNT(CASE WHEN estado = 'Rechazado' THEN 1 END) as rechazadas,
            /* CAMBIO AQUÍ: Solo suma el valor si el estado es exactamente 'Aprobado' */
            SUM(CASE WHEN estado = 'Aprobado' THEN valor ELSE 0 END) as valorTotal
        FROM solicitudes_compra`;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error en stats:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results[0] || { pendientes: 0, aprobadas: 0, rechazadas: 0, valorTotal: 0 });
    });
});

// A. Crear nueva solicitud (Desde index.html)
app.post('/api/solicitudes', upload.single('cotizacion'), (req, res) => {
    const { responsable, correo, proveedor, nit, valor, medioPago, centroCostos } = req.body;
    const archivo = req.file ? req.file.filename : null;

    const sql = `INSERT INTO solicitudes_compra 
    (responsable, correo, proveedor, nit, valor, medio_pago, centro_costos, archivo_cotizacion) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [responsable, correo, proveedor, nit, valor, medioPago, centroCostos, archivo];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("❌ Error en MySQL:", err);
            return res.status(500).json({ error: err.message });
        }

        // --- EL CÓDIGO DE BREVO DEBE IR AQUÍ ADENTRO ---
        // Porque aquí es donde 'responsable' y 'proveedor' tienen valor
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.subject = `🚨 Nueva Solicitud: ${responsable} - ${proveedor}`;
        sendSmtpEmail.htmlContent = `
            <div style="font-family: sans-serif; padding: 20px;">
                <h2>Nueva Solicitud de Compra</h2>
                <p><b>Responsable:</b> ${responsable}</p>
                <p><b>Proveedor:</b> ${proveedor}</p>
                <p><b>Valor:</b> $${Number(valor).toLocaleString()}</p>
            </div>`;

        sendSmtpEmail.sender = { "name": "Simon Bolivar", "email": "notificacionesticsimonbolivar@gmail.com" };
        sendSmtpEmail.to = [{ "email": "tic3@repuestossimonbolivar.com" }];

        apiInstance.sendTransacEmail(sendSmtpEmail).then(
            (data) => console.log("🚀 Correo enviado:", data.messageId),
            (error) => console.error("❌ Error Brevo:", error)
        );

        // Respuesta al usuario
        res.status(200).json({ message: 'Solicitud enviada exitosamente.' });
    });
});
// 5. INICIAR SERVIDOR
app.listen(PORT, () => {
    console.log(` Servidor RSB corriendo en http://localhost:${PORT}`);
});















