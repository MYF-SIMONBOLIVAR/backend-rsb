
const express = require('express');
const { Pool } = require('pg'); // ✅ Corregido
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Brevo = require('@getbrevo/brevo');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. Configuración de Cloudinary (Asegúrate de tener estas variables en Render)
cloudinary.config({
  cloud_name: process.env.NAME,
  api_key: process.env.KEY,
  api_secret: process.env.SECRET
});

// 2. Configuración de Multer con Cloudinary (Para que los PDF se guarden de verdad)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'cotizaciones_rsb',
    format: async (req, file) => 'pdf', 
    public_id: (req, file) => Date.now() + '-' + file.originalname,
  },
});
const upload = multer({ storage: storage });

// Conexión a la DB de Render (PostgreSQL)
const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Función para crear la tabla si no existe
const iniciarTabla = async () => {
    const sql = `
        CREATE TABLE IF NOT EXISTS solicitudes_compra (
            id SERIAL PRIMARY KEY,
            responsable VARCHAR(100),
            correo VARCHAR(100),
            proveedor VARCHAR(100),
            nit VARCHAR(20),
            valor DECIMAL(15,2),
            descripcion TEXT,
            medio_pago VARCHAR(50),
            centro_costos VARCHAR(100),
            archivo_cotizacion VARCHAR(500),
            estado VARCHAR(20) DEFAULT 'Pendiente',
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await db.query(sql);
        console.log("✅ Tabla solicitudes_compra lista en Render");
    } catch (err) {
        console.error("❌ Error al inicializar tabla:", err.message);
    }
};

iniciarTabla();

// --- RUTA POST PARA SOLICITUDES ---
app.post('/api/solicitudes', upload.single('cotizacion'), async (req, res) => {
    try {
        // 1. Captura de datos del formulario
        const { responsable, correo, proveedor, nit, valor, descripcion, medioPago, centroCostos } = req.body;
        
        // 2. Limpieza de valor (Para columna tipo NUMERIC)
        const valorNumerico = parseFloat(String(valor).replace(/[^0-9.]/g, '')) || 0;
        
        // 3. Manejo del archivo
        const archivoNombre = req.file ? `Adjunto: ${req.file.originalname}` : 'Sin archivo';

        // 4. SQL: 10 columnas = 10 marcadores ($1 al $10)
        // Columnas: 1.responsable, 2.correo, 3.proveedor, 4.nit, 5.valor, 6.descripcion, 7.medio_pago, 8.centro_costos, 9.archivo_cotizacion, 10.estado
        const sql = `INSERT INTO solicitudes_compra 
            (responsable, correo, proveedor, nit, valor, descripcion, medio_pago, centro_costos, archivo_cotizacion, estado) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`;

        // 5. Array de valores en el MISMO ORDEN que el SQL
        const values = [
            responsable || 'Anónimo',      // $1
            correo || null,               // $2
            proveedor || 'N/A',            // $3
            nit || '0',                   // $4
            valorNumerico,                // $5 (Como número real)
            descripcion || '',            // $6
            medioPago || 'No especificado',// $7
            centroCostos || 'General',     // $8
            archivoNombre,                // $9
            'Pendiente'                   // $10
        ];

        // 6. Ejecución en Render DB
        const result = await db.query(sql, values);
        const nuevoId = result.rows[0].id;

        console.log("✅ Registro exitoso en Postgres. ID:", nuevoId);

        // 7. Respuesta al navegador
        res.status(200).json({ 
            success: true, 
            message: 'Solicitud enviada correctamente', 
            id: nuevoId 
        });

    } catch (error) {
        // Log detallado en la consola de Render para saber exactamente qué falló
        console.error("❌ ERROR EN INSERT:", error.message);
        res.status(500).json({ 
            error: "Error en el servidor", 
            detalle: error.message 
        });
    }
});

// Función auxiliar para limpiar el código principal
async function enviarNotificacionAdmin(responsable, proveedor, nit, centroCostos, valorLimpio) {
    try {
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.subject = `Nueva Solicitud de Compra: ${responsable} - ${proveedor}`;
        sendSmtpEmail.htmlContent = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #19287F; padding: 20px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 20px; text-transform: uppercase;">Nueva Solicitud RSB</h1>
                </div>
                <div style="padding: 30px; line-height: 1.6;">
                    <p>Se ha registrado una nueva solicitud de compra:</p>
                    <ul>
                        <li><b>Responsable:</b> ${responsable}</li>
                        <li><b>Proveedor:</b> ${proveedor}</li>
                        <li><b>Valor:</b> $${Number(valorLimpio).toLocaleString()}</li>
                    </ul>
                    <a href="https://compras.repuestossimonbolivar.com/admin" style="display:inline-block; background:#19287F; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Gestionar en Panel</a>
                </div>
            </div>`;

        sendSmtpEmail.sender = { "name": "Sistema de Compras RSB", "email": "notificacionesticsimonbolivar@gmail.com" };
        sendSmtpEmail.to = [{ "email": "directoradministrativo@repuestossimonbolivar.com" }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log("📧 Correo de notificación enviado al Admin");
    } catch (e) {
        console.error("❌ Error enviando correo al admin:", e.message);
    }
}

// 2. LISTADO CON FILTROS (GET)
app.get('/api/solicitudes', async (req, res) => {
    const { inicio, fin, medio, proveedor, estado } = req.query;
    
    // 1. Construcción dinámica de la consulta (Postgres usa $1, $2...)
    let sql = "SELECT * FROM solicitudes_compra WHERE 1=1";
    const values = [];
    let count = 1;

    if (inicio && fin) {
        sql += ` AND fecha_creacion BETWEEN $${count++} AND $${count++}`;
        values.push(`${inicio} 00:00:00`, `${fin} 23:59:59`);
    }
    
    if (medio && medio !== "") { 
        sql += ` AND medio_pago = $${count++}`; 
        values.push(medio); 
    }
    
    if (proveedor && proveedor !== "") {
        sql += ` AND (proveedor ILIKE $${count++} OR responsable ILIKE $${count++})`;
        values.push(`%${proveedor}%`, `%${proveedor}%`);
    }
    
    if (estado && estado !== "") { 
        sql += ` AND estado = $${count++}`; 
        values.push(estado); 
    }

    // 2. Orden jerárquico compatible con PostgreSQL (CASE WHEN)
    sql += ` ORDER BY 
                CASE estado 
                    WHEN 'Pendiente' THEN 1 
                    WHEN 'Aprobado' THEN 2 
                    WHEN 'Rechazado' THEN 3 
                    ELSE 4 
                END, 
                fecha_creacion DESC`;

    try {
        // 3. Ejecución usando async/await (librería pg)
        const result = await db.query(sql, values);
        
        // Enviamos result.rows (que es el array de datos)
        res.json(result.rows || []);

    } catch (err) {
        console.error("❌ ERROR CRÍTICO EN /api/solicitudes:", err.message);
        // Devolvemos array vacío para que el frontend no rompa
        res.status(500).json([]); 
    }
});

// 3. ACTUALIZAR ESTADO (APROBAR/RECHAZAR DESDE ADMIN.HTML)
// --- ACTUALIZAR ESTADO (PUT) ---
app.put('/api/solicitudes/:id', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    console.log(`--- Iniciando actualización ID: ${id} a estado: ${estado} ---`);

    try {
        // A. Buscar los datos en PostgreSQL (usando $1)
        // Nota: Postgres devuelve los nombres de columnas en minúsculas
        const result = await db.query(
            "SELECT correo, responsable, proveedor, valor FROM solicitudes_compra WHERE id = $1", 
            [id]
        );

        if (result.rows.length === 0) {
            console.error(`❌ No se encontró la solicitud con ID: ${id}`);
            return res.status(404).json({ error: "No se encontró la solicitud" });
        }

        const { correo, responsable, proveedor, valor } = result.rows[0];

        // B. Actualizar el estado en la base de datos
        await db.query(
            "UPDATE solicitudes_compra SET estado = $1 WHERE id = $2", 
            [estado, id]
        );

        console.log(`✅ Base de datos actualizada: ID ${id} ahora es ${estado}`);

        // C. Configuración de Correo (Diseño mejorado)
        const colorEstado = estado === 'Aprobado' ? '#2ecc71' : '#e74c3c';
        const icono = estado === 'Aprobado' ? '✅' : '❌';

        const apiInstance = new Brevo.TransactionalEmailsApi(); // Asegúrate de que apiInstance esté definido
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
                        <span style="font-size: 24px; font-weight: bold; color: ${colorEstado}; text-transform: uppercase; letter-spacing: 2px;">${estado}</span>
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
                            : 'Si tiene dudas sobre esta decisión, por favor póngase en contacto con el departamento encargado.'}
                    </p>
                </div>
                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
                    Atentamente, <b>Repuestos Simón Bolívar</b>
                </div>
            </div>`;

        sendSmtpEmail.sender = { "name": "Sistema de Compras RSB", "email": "notificacionesticsimonbolivar@gmail.com" };
        sendSmtpEmail.to = [{ "email": correo }];

        // D. Envío asíncrono del correo
        apiInstance.sendTransacEmail(sendSmtpEmail)
            .then(() => console.log(`📧 Correo enviado a ${correo}`))
            .catch(e => console.error("❌ Error Brevo:", e));

        // Respuesta final exitosa
        res.json({ success: true, message: `Solicitud ${estado} correctamente.` });

    } catch (error) {
        console.error("❌ Error en PUT:", error.message);
        res.status(500).json({ error: "Error interno al actualizar la solicitud." });
    }
});

// --- ESTADÍSTICAS (GET) ---
app.get('/api/stats', async (req, res) => {
    try {
        const sql = `
    SELECT 
        COUNT(*) FILTER (WHERE estado = 'Pendiente') as pendientes,
        COUNT(*) FILTER (WHERE estado = 'Aprobado') as aprobadas,
        COUNT(*) FILTER (WHERE estado = 'Rechazado') as rechazadas,
        COALESCE(SUM(valor) FILTER (WHERE estado = 'Aprobado'), 0) as "valorTotal",
        COALESCE(SUM(valor) FILTER (WHERE estado = 'Pendiente'), 0) as "valorPendiente"
    FROM solicitudes_compra`;
        
        const result = await db.query(sql);
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error stats:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor RSB activo en puerto ${PORT}`);
});










































