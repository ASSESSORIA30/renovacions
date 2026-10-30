# Assessoria 3.0 — Renewal Intelligence Pro

Panel web de renovaciones en HTML, CSS y JavaScript. Ejecutable abriendo `index.html` y desplegable como web estática en Vercel.

## Funciones actuales
- Kanban con arrastrar y soltar, fichas editables, notas, filtros, calendario y estadísticas.
- Botones para preparar mensajes de WhatsApp y correo mediante wa.me y mailto.
- Plantillas de comunicación editables.
- Preparación de propuesta imprimible a PDF con datos introducidos por el usuario.
- Lectura directa CSV de Google Sheets **solo cuando el archivo es accesible desde el navegador**.
- Importación alternativa CSV o XLSX y mapeo visual de columnas.
- Persistencia local en el navegador (localStorage), no compartida entre dispositivos.

## Advertencias importantes
- **No hay autenticación de usuarios ni base de datos en esta versión.** No usar como CRM empresarial multiusuario sin añadir backend, autenticación y control de permisos.
- Google Sheets privado requiere backend con OAuth o cuenta de servicio. El botón Sincronizar no evita restricciones de Google.
- WhatsApp y email abren borradores; no confirman el envío. No hay SMTP configurado.
- Los datos iniciales son de demostración y no corresponden a clientes reales.
- El cálculo de propuesta es solo un comparador de dos costes anuales manuales; no es un motor tarifario 2.0TD/3.0TD/6.1TD.
- Datos locales pueden perderse al borrar el almacenamiento del navegador. Exportar CSV de forma regular.

## Despliegue
Importa la carpeta en GitHub y despliega el repositorio en Vercel como proyecto sin framework, con `index.html` en raíz. Las llamadas al CSV de Google se hacen en cliente. Para integrar un Google Sheets privado y soporte multiusuario, desarrollar una API server-side con Google Sheets API, Supabase Auth, RLS y políticas de sincronización.
