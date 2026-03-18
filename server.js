
const express = require('express');			
const mysql = require('pg');			
const cors = require('cors');			
const multer = require('multer');			
const path = require('path');			
const fs = require('fs');			
const Brevo = require('@getbrevo/brevo');			
const cloudinary = require('cloudinary').v2;			
const { CloudinaryStorage } = require('multer-storage-cloudinary');			


const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.memoryStorage();
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
        const { responsable, correo, proveedor, nit, valor, descripcion, medioPago, centroCostos } = req.body;
        const archivoNombre = req.file ? `Adjunto: ${req.file.originalname}` : 'Sin archivo';
        const valorLimpio = valor ? String(valor).replace(/[^0-9.]/g, '') : 0;

        const sql = `INSERT INTO solicitudes_compra 
            (responsable, correo, proveedor, nit, valor, descripcion, medio_pago, centro_costos, archivo_cotizacion, estado) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pendiente') RETURNING id`;

        const values = [
            responsable || 'Anónimo',
            correo || null,
            proveedor || 'N/A',
            nit || '0',
            valorLimpio,
            descripcion || '',
            medioPago || 'No especificado',
            centroCostos || 'General',
            archivoNombre
        ];

        const result = await db.query(sql, values);
        console.log("✅ Registro guardado con ID:", result.rows[0].id);

        res.status(200).json({ success: true, id: result.rows[0].id });

    } catch (error) {
        console.error("❌ Error en el proceso:", error.message);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Sistema RSB en Render activo`));
            
            // 6. Notificación a TIC (Dentro del callback para asegurar que se guardó en BD)
            const sendSmtpEmail = new Brevo.SendSmtpEmail();
            sendSmtpEmail.subject = `Nueva Solicitud de Compra: ${responsable} - ${proveedor}`;
            sendSmtpEmail.htmlContent = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #19287F; padding: 20px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 20px; text-transform: uppercase;">Portal de Solicitud de Compras</h1>
                    </div>
                    <div style="padding: 30px; line-height: 1.6;">
                        <p style="font-size: 16px;">Cordial saludo,</p>
                        <p>Se ha registrado una <b>nueva solicitud de compra</b> en el sistema.</p>
                        <div style="background-color: #f8fafc; border-radius: 6px; padding: 20px; margin: 20px 0; border-left: 4px solid #19287F;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr><td style="padding: 5px 0;"><b>Responsable:</b></td><td>${responsable}</td></tr>
                                <tr><td style="padding: 5px 0;"><b>Proveedor:</b></td><td>${proveedor} (NIT: ${nit})</td></tr>
                                <tr><td style="padding: 5px 0;"><b>Centro de Costos:</b></td><td>${centroCostos || 'No especificado'}</td></tr>
                                <tr><td style="padding: 5px 0;"><b>Valor Total:</b></td><td style="font-size: 18px; color: #19287F;"><b>$${Number(valorNumerico).toLocaleString()}</b></td></tr>
                            </table>
                        </div>
                        <p style="text-align: center; margin-top: 30px;">
                            <a href="https://compras.repuestossimonbolivar.com/admin" style="background-color: #19287F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">GESTIONAR SOLICITUD</a>
                        </p>
                    </div>
                </div>`;

            sendSmtpEmail.sender = { "name": "Sistema de Compras RSB", "email": "notificacionesticsimonbolivar@gmail.com" };
            sendSmtpEmail.to = [{ "email": "directoradministrativo@repuestossimonbolivar.com" }];

            apiInstance.sendTransacEmail(sendSmtpEmail).catch(e => console.error("Error Brevo:", e));

            // Respuesta final al cliente
            res.status(200).json({ success: true, message: 'Solicitud enviada', id: result.insertId });
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









































