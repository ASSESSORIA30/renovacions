# Assessoria 3.0 · Renewal Pro — Google Sheets privado

## Fuente
Google Sheets ID `1--1SR3M68rc9YEU-Jj3_mMUQfHDSqVwG`. Se lee automáticamente la pestaña **Contratos** o **Contractes** y todas las columnas hasta ZZ; la fila 1 es la cabecera. No se usa una publicación CSV pública.

## Configurar Google Cloud
1. Crear o seleccionar proyecto de Google Cloud y activar **Google Sheets API**.
2. Crear una **cuenta de servicio** y generar clave JSON (custodiar en secreto).
3. Compartir el archivo Google Sheets con el correo `client_email` de esa cuenta de servicio como **Lector**.
4. Desplegar este directorio como proyecto Vercel.
5. Configurar variables de entorno en Vercel (Production):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: `client_email` del JSON.
   - `GOOGLE_PRIVATE_KEY`: `private_key` del JSON, con 
 o saltos de línea reales.
   - `PANEL_ACCESS_TOKEN`: frase secreta aleatoria y larga elegida por ti.
6. Volver a desplegar para activar las variables.
7. Abrir panel por **HTTPS**, pulsar **Sincronizar** y facilitar la clave del panel. Se guarda solo en `sessionStorage` de esa pestaña del navegador.

## Comportamiento
- Sincronización al abrir la página cuando existe sesión autorizada, cada 15 minutos con página visible, y manual con el botón.
- Google Sheets es lectura: el Kanban, notas y estados se guardan **solo en el navegador**. No hay sincronización multiusuario, ni escritura de vuelta a Google Sheets, ni control de permisos por comercial.
- No se inventan vencimientos cuando la hoja no los contiene. 
- Evitar desplegar el HTML en acceso público sin restringir acceso a la página: el endpoint sí requiere clave; recomendamos además Vercel Deployment Protection / autenticación de usuario antes de utilizarlo con datos reales.
- No introducir la clave de cuenta de servicio en el HTML, JavaScript de cliente o GitHub.
- Si hay cambios en los nombres de columna, revisar el mapeo en el panel.

## Seguridad
Google Sheets contiene datos personales. No publicar el archivo ni hacerlo accesible con «Cualquiera con el enlace». El backend aplica una contraseña de acceso al API; para un despliegue profesional multiusuario se requiere autenticación y autorización por usuario (p.ej. Supabase Auth + políticas de acceso), almacenamiento centralizado de los estados e histórico de auditoría.
