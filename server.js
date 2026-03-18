
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

// --- MIDDLEWARES ---
app.use(cors({
 origin: ['https://compras.repuestossimonbolivar.com'],
 methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
 allowedHeaders: ['Content-Type', 'Authorization'],
 credentials: true,
}));
app.options('*', cors());


// --- CONFIGURACIÓN DE CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.NAME,
  api_key:    process.env.KEY,
  api_secret: process.env.SECRET
});

// --- CONFIGURACIÓN DE ALMACENAMIENTO (MULTER + CLOUDINARY) ---
// Actualiza tu configuración de storage así:
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'cotizaciones_rsb',
    resource_type: 'raw', 
    // Forzamos que el acceso sea público y no requiera firma
    access_control: [{ access_type: 'anonymous' }], 
    public_id: (req, file) => Date.now() + '-' + file.originalname.split('.')[0],
  },
});

// AQUÍ CORREGIDO: Solo una declaración de 'upload'
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 5 * 1024 * 1024 } 
});

// --- CONEXIÓN A BASE DE DATOS ---
const db = mysql.createPool({
    host: '193.203.175.239', 
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306,
    connectionLimit: 5,
    connectTimeout: 20000, // 20 segundos de espera
    ssl: false // Hostinger suele rechazar SSL externo
});

// A. CREAR SOLICITUD
app.post('/api/solicitudes', upload.single('cotizacion'), (req, res) => {
    try {
        // 1. Datos del body
        const { responsable, correo, proveedor, nit, valor, descripcion, medioPago, centroCostos } = req.body;
        
        // 2. Manejo de archivo (usando memoria para evitar fallos de disco en Render)
        const archivoUrl = req.file ? `Archivo: ${req.file.originalname}` : 'Sin archivo';
        
        // 3. Limpieza de valor para decimal(15,2)
        const valorNumerico = valor ? String(valor).replace(/[^0-9.]/g, '') : 0;

        // 4. SQL sincronizado con tu DESCRIBE
        const sql = `INSERT INTO solicitudes_compra 
            (responsable, correo, proveedor, nit, valor, descripcion, medio_pago, centro_costos, archivo_cotizacion, estado) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente')`;

        const values = [
            responsable || 'Anónimo',
            correo || null,
            proveedor || 'N/A',
            nit || '0',
            valorNumerico,
            descripcion || '',
            medioPago || 'No especificado',
            centroCostos || 'General',
            archivoUrl
        ];

        // 5. Ejecución
        db.query(sql, values, (err, result) => {
            if (err) {
                console.error("❌ ERROR MYSQL:", err.message);
                return res.status(500).json({ 
                    error: "Error en Base de Datos", 
                    mensaje: err.message 
                });
            }

            console.log("✅ Registro exitoso. ID:", result.insertId);
            
            // Intentar enviar correo (si falla el correo, la solicitud ya quedó guardada)
            try {
                enviarNotificacionBrevo(responsable, proveedor, valorNumerico);
            } catch (mailErr) {
                console.error("Error enviando mail:", mailErr);
            }

            res.status(200).json({ success: true, id: result.insertId });
        });

    } catch (error) {
        console.error("❌ ERROR CRÍTICO:", error);
        res.status(500).json({ error: "Fallo interno del servidor" });
    }
});

            // Notificación a TIC
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
        sendSmtpEmail.to = [{ "email": "directoradministrativo@repuestossimonbolivar.com" }];

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
    
    // 1. Construcción dinámica de la consulta
    let sql = "SELECT * FROM solicitudes_compra WHERE 1=1";
    const values = [];

    if (inicio && fin) {
        sql += " AND fecha_creacion BETWEEN ? AND ?";
        values.push(`${inicio} 00:00:00`, `${fin} 23:59:59`);
    }
    
    if (medio && medio !== "") { 
        sql += " AND medio_pago = ?"; 
        values.push(medio); 
    }
    
    if (proveedor && proveedor !== "") {
        sql += " AND (proveedor LIKE ? OR responsable LIKE ?)";
        values.push(`%${proveedor}%`, `%${proveedor}%`);
    }
    
    if (estado && estado !== "") { 
        sql += " AND estado = ?"; 
        values.push(estado); 
    }

    // Orden jerárquico: Pendientes arriba, luego Aprobadas y Rechazadas por fecha reciente
    sql += " ORDER BY FIELD(estado, 'Pendiente', 'Aprobado', 'Rechazado'), fecha_creacion DESC";

    // 2. Ejecución con manejo de errores robusto
    db.query({ sql, values, timeout: 15000 }, (err, results) => {
        if (err) {
            // Log para que veas el error real en el panel de Render
            console.error("❌ ERROR CRÍTICO EN /api/solicitudes:", err.code);
            
            /* IMPORTANTE: Devolvemos status 500 pero con un array vacío []. 
               Esto evita el error "datos.forEach is not a function" en el frontend 
               porque el frontend recibirá una lista (aunque esté vacía).
            */
            return res.status(500).json([]); 
        }

        // 3. Respuesta exitosa
        // Si por alguna razón no hay resultados, enviamos un array vacío por defecto
        res.json(results || []);
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









































