# CI/CD con GitHub Actions: .NET Core API + Angular

Tutorial completo para configurar pipelines de integración y despliegue continuo (CI/CD) usando **GitHub Actions** para una API .NET 8 y una aplicación Angular 17, con despliegue automático en **Windows** mediante un self-hosted runner.

---

## Tabla de Contenidos

1. [Estructura del Proyecto](#1-estructura-del-proyecto)
2. [Prerequisitos](#2-prerequisitos)
3. [Configuración Local (desarrollo)](#3-configuración-local-desarrollo)
4. [Arquitectura de los Pipelines](#4-arquitectura-de-los-pipelines)
5. [Paso a Paso: Configurar el Self-Hosted Runner en Windows](#5-paso-a-paso-configurar-el-self-hosted-runner-en-windows)
6. [Paso a Paso: Preparar Windows para el Despliegue](#6-paso-a-paso-preparar-windows-para-el-despliegue)
7. [Configurar Secrets y Variables en GitHub](#7-configurar-secrets-y-variables-en-github)
8. [Flujo de Trabajo Completo](#8-flujo-de-trabajo-completo)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Estructura del Proyecto

```
.
├── .github/
│   └── workflows/
│       ├── backend.yml       ← Pipeline .NET:    Build → Release → Deploy (Windows)
│       └── frontend.yml      ← Pipeline Angular: Build → Release → Deploy (Windows)
│
├── backend/
│   ├── TodoApi.sln
│   └── src/TodoApi/
│       ├── Controllers/TodoController.cs   (CRUD: GET/POST/PUT/DELETE /api/todos)
│       ├── Models/Todo.cs
│       ├── Program.cs                      (Swagger + CORS + Windows Service support)
│       ├── TodoApi.csproj                  (.NET 8, compila para win-x64)
│       └── appsettings.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── app.component.ts            (Angular 17 standalone + signals)
│   │   │   ├── app.component.html          (control flow @if / @for)
│   │   │   ├── app.component.css
│   │   │   ├── app.component.spec.ts       (3 unit tests)
│   │   │   └── todo.service.ts             (HttpClient + Observables)
│   │   ├── environments/
│   │   │   ├── environment.ts              (dev: localhost:5000)
│   │   │   └── environment.prod.ts         (prod: tu servidor)
│   │   ├── web.config                      (IIS: SPA routing + MIME types)
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── styles.css
│   ├── angular.json
│   ├── package.json
│   └── tsconfig.json
│
├── .gitignore
└── README.md
```

---

## 2. Prerequisitos

### En la máquina de desarrollo

| Herramienta    | Versión  | Cómo instalar                                   |
|----------------|----------|-------------------------------------------------|
| .NET SDK       | 8.0+     | https://dotnet.microsoft.com/download           |
| Node.js        | 18.x+    | https://nodejs.org                              |
| Angular CLI    | 17.x     | `npm install -g @angular/cli`                   |
| Git            | 2.x+     | https://git-scm.com                             |

### En la máquina Windows donde se desplegará (puede ser la misma)

| Componente                  | Para qué se usa                          |
|-----------------------------|------------------------------------------|
| .NET 8 Runtime (ASP.NET)    | Ejecutar el backend como Windows Service |
| IIS (Internet Information Services) | Servir el frontend Angular       |
| IIS URL Rewrite Module      | Soporte de rutas para Angular SPA        |
| PowerShell 7+ (pwsh)        | Ejecutar los pasos del pipeline          |

---

## 3. Configuración Local (desarrollo)

### Levantar el Backend

```powershell
cd backend
dotnet restore
dotnet run --project src/TodoApi/TodoApi.csproj
```

| URL | Descripción |
|-----|-------------|
| http://localhost:5000/api/todos | API REST |
| http://localhost:5000/swagger   | Swagger UI (solo en Development) |

### Levantar el Frontend

```powershell
cd frontend
npm install
npm start
```

La app queda en: **http://localhost:4200**

> Asegúrate de que el backend esté corriendo antes de abrir el frontend.

---

## 4. Arquitectura de los Pipelines

Cada aplicación (backend y frontend) tiene su propio archivo de workflow con **3 jobs que se ejecutan en secuencia**:

```
TRIGGER: git push de tag  v*.*.*
         │
         ├── backend.yml ──────────────────────────────────────────────┐
         │                                                              │
         └── frontend.yml ────────────────────────────────────────────┐│
                                                                       ││
┌──────────────────────────────────────────────────────────────────────▼▼─────┐
│  JOB 1 · build                        runs-on: ubuntu-latest                │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Backend                              │  Frontend                           │
│  • dotnet restore                     │  • npm ci                           │
│  • dotnet build --configuration Release│  • ng test --browsers ChromeHeadless│
│  • dotnet test (si hay proyectos)     │  • ng build --configuration production│
│  • dotnet publish --runtime win-x64   │  • upload-artifact                  │
│  • upload-artifact                    │                                     │
└──────────────────────────────────────────────────────────┬──────────────────┘
                                                           │ needs: build
                                                           │ if: tag v*.*.*
┌──────────────────────────────────────────────────────────▼──────────────────┐
│  JOB 2 · release                      runs-on: ubuntu-latest                │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • download-artifact (del job build)                                        │
│  • zip -r app-v1.0.0.zip                                                    │
│  • softprops/action-gh-release  →  crea Release en GitHub con el .zip      │
└──────────────────────────────────────────────────────────┬──────────────────┘
                                                           │ needs: release
                                                           │ if: tag v*.*.*
┌──────────────────────────────────────────────────────────▼──────────────────┐
│  JOB 3 · deploy                       runs-on: [self-hosted, windows]       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Backend                              │  Frontend                           │
│  • download-artifact                  │  • download-artifact                │
│  • Stop-Service todoapi               │  • Remove-Item wwwroot\todo-app\*   │
│  • Copy-Item → C:\inetpub\todoapi\   │  • Copy-Item → C:\inetpub\wwwroot\ │
│  • New-Service (solo 1ra vez)         │    todo-app\                        │
│  • Start-Service todoapi              │  • New-Website / Restart-WebSite    │
│  • Invoke-WebRequest health check     │  • Invoke-WebRequest health check   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### ¿Cuándo se ejecuta cada job?

| Evento                       | build | release | deploy |
|------------------------------|:-----:|:-------:|:------:|
| Push a `develop`             |  ✅   |   ❌    |   ❌   |
| Push a `main`                |  ✅   |   ❌    |   ❌   |
| Pull Request hacia `main`    |  ✅   |   ❌    |   ❌   |
| Push de tag `v*.*.*`         |  ✅   |   ✅    |   ✅   |

---

## 5. Paso a Paso: Configurar el Self-Hosted Runner en Windows

El **Job 3 (deploy)** usa `runs-on: [self-hosted, windows]`. Necesitas instalar el agente de GitHub Actions en la máquina Windows donde se desplegará la aplicación.

---

### PARTE A — En GitHub (navegador web)

**Paso 1.** Abre tu repositorio en https://github.com

**Paso 2.** Haz clic en **Settings** (pestaña superior derecha del repo)

**Paso 3.** En el menú izquierdo, ve a **Actions → Runners**

**Paso 4.** Haz clic en el botón verde **"New self-hosted runner"**

**Paso 5.** En la pantalla que aparece:
- **Operating System**: selecciona **Windows**
- **Architecture**: selecciona **x64**

**Paso 6.** GitHub te mostrará 4 bloques de comandos PowerShell. **NO los ejecutes todavía.** Lo importante ahora es el **token** que aparece en el paso "Configure" — se ve así:

```
./config.cmd --url https://github.com/TU_USUARIO/TU_REPO --token AABBBCCC123456...
```

Copia ese token, lo usarás en la Parte B. **El token caduca en 1 hora.**

---

### PARTE B — En la máquina Windows (PowerShell como Administrador)

> Abre PowerShell haciendo clic derecho en el menú inicio → "Windows PowerShell (Admin)"
> o busca "PowerShell" y selecciona "Ejecutar como administrador".

**Paso 1.** Crear la carpeta del runner y entrar en ella:

```powershell
New-Item -ItemType Directory -Path "C:\actions-runner" -Force
Set-Location "C:\actions-runner"
```

**Paso 2.** Descargar el runner de GitHub Actions:

```powershell
# Descarga la versión más reciente (ajusta el número de versión si GitHub te da uno diferente)
$version = "2.317.0"
Invoke-WebRequest `
  -Uri "https://github.com/actions/runner/releases/download/v$version/actions-runner-win-x64-$version.zip" `
  -OutFile "actions-runner.zip"
```

> La URL exacta la encuentras en el bloque "Download" que GitHub te mostró en el Paso 6 de la Parte A.

**Paso 3.** Extraer el .zip descargado:

```powershell
Expand-Archive -Path "actions-runner.zip" -DestinationPath "." -Force
```

**Paso 4.** Configurar el runner con el token de GitHub:

```powershell
# Reemplaza TU_USUARIO, TU_REPO y TU_TOKEN_DE_GITHUB con tus valores reales
.\config.cmd `
  --url "https://github.com/TU_USUARIO/TU_REPO" `
  --token "TU_TOKEN_DE_GITHUB" `
  --name "windows-runner" `
  --labels "self-hosted,windows,local" `
  --work "_work"
```

El comando te hará algunas preguntas:
- **Enter the name of the runner group**: presiona Enter (usa "Default")
- **Enter the name of the runner**: presiona Enter o escribe un nombre descriptivo
- **Enter any additional labels**: presiona Enter
- **Enter name of work folder**: presiona Enter (usa "_work")

Cuando termine verás: `√ Settings Saved.`

**Paso 5.** Instalar el runner como Windows Service para que corra automáticamente:

```powershell
# Instalar el servicio
.\svc.cmd install

# Iniciar el servicio
.\svc.cmd start

# Verificar que está activo
.\svc.cmd status
```

Debes ver algo como:
```
Status = Running
```

**Paso 6.** Verificar en GitHub que el runner aparece activo:

1. Regresa a tu repo en GitHub
2. Ve a **Settings → Actions → Runners**
3. Verás tu runner `windows-runner` con estado **Idle** (punto verde)

El runner está listo para recibir jobs.

---

### Comandos útiles para gestionar el runner

```powershell
# Ver el estado del servicio
.\svc.cmd status

# Detener el runner
.\svc.cmd stop

# Iniciar el runner
.\svc.cmd start

# Desinstalar el servicio (si necesitas reconfigurarlo)
.\svc.cmd uninstall

# Ver los logs del runner en tiempo real
Get-Content "C:\actions-runner\_diag\Runner_*.log" -Tail 50 -Wait
```

---

## 6. Paso a Paso: Preparar Windows para el Despliegue

### Backend: .NET 8 Runtime + Windows Service

**Paso 1.** Instalar el .NET 8 ASP.NET Core Runtime en Windows:

Descarga e instala desde: https://dotnet.microsoft.com/download/dotnet/8.0
→ Busca la sección "ASP.NET Core Runtime 8.0.x" → descarga el instalador `.exe` para Windows x64.

Verifica la instalación:
```powershell
dotnet --version
# debe mostrar algo como: 8.0.x
```

**Paso 2.** Crear la carpeta de despliegue del backend:

```powershell
New-Item -ItemType Directory -Path "C:\inetpub\todoapi" -Force
```

**Paso 3.** El Windows Service se crea automáticamente en el primer deploy. Para crearlo manualmente antes del primer pipeline:

```powershell
# Solo si quieres configurarlo antes de correr el pipeline por primera vez
$exePath = "C:\inetpub\todoapi\TodoApi.exe"

New-Service -Name "todoapi" `
            -BinaryPathName $exePath `
            -DisplayName "Todo API - .NET 8" `
            -Description "ASP.NET Core 8 REST API" `
            -StartupType Automatic

# Configurar variables de entorno
[System.Environment]::SetEnvironmentVariable("ASPNETCORE_URLS", "http://localhost:5000", "Machine")
[System.Environment]::SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production", "Machine")
```

> El pipeline del Job 3 crea el servicio automáticamente si no existe.

**Paso 4.** Abrir el puerto 5000 en el Firewall de Windows:

```powershell
New-NetFirewallRule `
  -DisplayName "Todo API .NET" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 5000 `
  -Action Allow
```

---

### Frontend: IIS + URL Rewrite

**Paso 1.** Habilitar IIS en Windows:

```powershell
# Habilitar IIS y los componentes necesarios
Enable-WindowsOptionalFeature -Online -FeatureName `
  IIS-WebServerRole, `
  IIS-WebServer, `
  IIS-CommonHttpFeatures, `
  IIS-StaticContent, `
  IIS-DefaultDocument, `
  IIS-HttpErrors, `
  IIS-Security, `
  IIS-RequestFiltering, `
  IIS-HttpLogging `
  -All
```

> En Windows 11 Pro también puedes habilitarlo desde:
> Panel de Control → Programas → Activar o desactivar características de Windows → Internet Information Services

**Paso 2.** Instalar el módulo **URL Rewrite** (obligatorio para Angular Router):

Descarga e instala desde: https://www.iis.net/downloads/microsoft/url-rewrite
→ Descarga "x64" → ejecuta el instalador.

O con **winget**:
```powershell
winget install Microsoft.IISUrlRewrite
```

**Paso 3.** Crear la carpeta y el sitio IIS para el frontend:

```powershell
# Crear la carpeta
New-Item -ItemType Directory -Path "C:\inetpub\wwwroot\todo-app" -Force

# Importar el módulo de administración de IIS
Import-Module WebAdministration

# Detener el sitio por defecto de IIS (usa el puerto 80)
Stop-WebSite -Name "Default Web Site" -ErrorAction SilentlyContinue

# Crear el sitio para la Todo App
New-Website -Name "todo-app" `
            -Port 80 `
            -PhysicalPath "C:\inetpub\wwwroot\todo-app" `
            -Force

# Iniciar el sitio
Start-Website -Name "todo-app"
```

**Paso 4.** Verificar que IIS está corriendo:

```powershell
# Ver el estado de los sitios IIS
Get-Website | Select-Object Name, State, PhysicalPath

# Probar IIS abriendo en el navegador:
Start-Process "http://localhost"
```

**Paso 5.** Abrir el puerto 80 en el Firewall de Windows:

```powershell
New-NetFirewallRule `
  -DisplayName "IIS HTTP" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 80 `
  -Action Allow
```

---

## 7. Configurar Secrets y Variables en GitHub

### Variables de repositorio (valores no sensibles)

Ve a tu repo → **Settings → Secrets and variables → Actions → Variables → New repository variable**

| Variable        | Valor de ejemplo  | Descripción                    |
|-----------------|-------------------|--------------------------------|
| `SERVER_HOST`   | `localhost`       | Host donde corre la aplicación |

### Secrets (valores sensibles)

> Para este proyecto, como el self-hosted runner corre **en la misma máquina** que el servidor, no se necesitan secrets adicionales. Los jobs de deploy corren localmente en esa máquina.

Si en el futuro necesitas conectarte a un servidor remoto por SSH, agrega:

| Secret            | Descripción                       |
|-------------------|-----------------------------------|
| `SSH_PRIVATE_KEY` | Llave SSH privada para el servidor|

---

## 8. Flujo de Trabajo Completo

### Durante el desarrollo (solo dispara Build)

```bash
# 1. Crear rama feature
git checkout develop
git checkout -b feature/nueva-funcionalidad

# 2. Hacer cambios y commits
git add .
git commit -m "feat: descripcion de la funcionalidad"

# 3. Push — dispara automáticamente el Job 1 (Build & Test) en ubuntu-latest
git push origin feature/nueva-funcionalidad
```

Puedes ver el resultado en: **pestaña Actions** del repositorio en GitHub.

---

### Crear un Release y desplegar a producción

```bash
# 1. Asegúrate de estar en main con todos los cambios integrados
git checkout main
git pull origin main

# 2. Crear el tag con versionado semántico (MAJOR.MINOR.PATCH)
git tag -a v1.0.0 -m "Release: primera version estable"

# 3. Push del tag — esto dispara los 3 jobs en secuencia
git push origin v1.0.0
```

#### Lo que sucede automáticamente en GitHub Actions:

```
Segundos 0-120:
  [Job 1 · BUILD · ubuntu-latest]
  ✓ dotnet publish --runtime win-x64 → genera binario Windows
  ✓ ng build --configuration production → genera bundle Angular
  ✓ Sube artefactos al storage de GitHub Actions

Segundos 120-180:
  [Job 2 · RELEASE · ubuntu-latest]
  ✓ Descarga artefactos del Job 1
  ✓ Crea backend-v1.0.0.zip y frontend-v1.0.0.zip
  ✓ Publica el Release en GitHub con los .zip adjuntos

Segundos 180-240:
  [Job 3 · DEPLOY · self-hosted Windows]
  ✓ Descarga artefactos del Job 1
  ✓ Stop-Service todoapi
  ✓ Copia archivos a C:\inetpub\todoapi\
  ✓ Start-Service todoapi
  ✓ Copia archivos a C:\inetpub\wwwroot\todo-app\
  ✓ Restart-WebSite todo-app
  ✓ Verifica que API y frontend responden (health checks)
```

### Ver el Release en GitHub

1. Abre el repositorio en GitHub
2. Haz clic en **Releases** (columna derecha o menú superior)
3. Verás el release `v1.0.0` con:
   - Notas de release generadas automáticamente desde los commits
   - `backend-v1.0.0.zip` descargable
   - `frontend-v1.0.0.zip` descargable

---

## 9. Troubleshooting

### El runner no aparece como "Idle" en GitHub

```powershell
# Verificar el estado del servicio Windows del runner
Set-Location "C:\actions-runner"
.\svc.cmd status

# Si dice Stopped, iniciarlo
.\svc.cmd start

# Ver los logs más recientes del runner
Get-ChildItem "C:\actions-runner\_diag\Runner_*.log" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  Get-Content -Tail 50
```

### El Job 3 no corre — el runner no recoge el job

Verifica que el runner tenga los labels correctos. El workflow usa `runs-on: [self-hosted, windows]`. El runner debe tener **ambos** labels.

```powershell
# Ver los labels configurados del runner
Get-Content "C:\actions-runner\.runner" | ConvertFrom-Json | Select-Object -ExpandProperty labels
```

Si faltan labels, reconfigura:
```powershell
.\svc.cmd stop
.\config.cmd remove --token TU_TOKEN_NUEVO
.\config.cmd --url "https://github.com/TU/REPO" --token "TU_TOKEN" --labels "self-hosted,windows,local"
.\svc.cmd install
.\svc.cmd start
```

### El servicio `todoapi` no arranca

```powershell
# Ver el estado detallado del servicio
Get-Service -Name "todoapi" | Format-List *

# Ver el log de eventos de Windows para errores del servicio
Get-EventLog -LogName Application -Source ".NET Runtime" -Newest 10

# Ver si el ejecutable existe
Test-Path "C:\inetpub\todoapi\TodoApi.exe"

# Intentar correrlo manualmente para ver el error
Set-Location "C:\inetpub\todoapi"
$env:ASPNETCORE_URLS = "http://localhost:5000"
$env:ASPNETCORE_ENVIRONMENT = "Production"
.\TodoApi.exe
```

### El frontend devuelve 404 al navegar rutas de Angular

El `web.config` incluido en el proyecto configura IIS para redirigir todo al `index.html`. Verifica que:

1. El archivo `web.config` se desplegó correctamente:
```powershell
Test-Path "C:\inetpub\wwwroot\todo-app\web.config"
Get-Content "C:\inetpub\wwwroot\todo-app\web.config"
```

2. El módulo URL Rewrite está instalado:
```powershell
Get-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" `
  -Filter "system.webServer/globalModules/add[@name='RewriteModule']" `
  -Name "."
```

Si no está instalado, descárgalo de https://www.iis.net/downloads/microsoft/url-rewrite

### Error de permisos en el Job 3 (deploy)

El servicio del runner en Windows corre por defecto como `NT AUTHORITY\NETWORK SERVICE`. Para que pueda crear/copiar archivos y gestionar servicios, cámbialo a una cuenta con más permisos:

```powershell
# En la consola de Servicios (services.msc):
# 1. Busca el servicio "GitHub Actions Runner (TU_REPO)"
# 2. Clic derecho → Propiedades → Inicio de sesión
# 3. Cambia a "Esta cuenta" y usa tu cuenta de usuario Windows

# O desde PowerShell (reemplaza USUARIO y CONTRASEÑA):
$svcName = "actions.runner.TU_USUARIO-TU_REPO.windows-runner"
$credential = New-Object System.Management.Automation.PSCredential(
  ".\TU_USUARIO",
  (ConvertTo-SecureString "TU_CONTRASEÑA" -AsPlainText -Force)
)
$svc = Get-WmiObject Win32_Service -Filter "Name='$svcName'"
$svc.Change($null,$null,$null,$null,$null,$null,$credential.UserName,$credential.GetNetworkCredential().Password)
Restart-Service $svcName
```

### Verificar que todo funciona end-to-end

```powershell
# 1. Backend responde
Invoke-WebRequest "http://localhost:5000/api/todos" -UseBasicParsing | Select-Object StatusCode

# 2. Frontend carga
Invoke-WebRequest "http://localhost" -UseBasicParsing | Select-Object StatusCode

# 3. Runner está activo
Set-Location "C:\actions-runner"
.\svc.cmd status

# 4. Servicio del API está corriendo
Get-Service todoapi | Select-Object Name, Status, StartType
```

---

## Actualizar la URL del API para producción

Antes del primer deploy, edita `frontend/src/environments/environment.prod.ts`:

```typescript
export const environment = {
  production: true,
  apiUrl: 'http://localhost:5000'  // si frontend y backend corren en la misma PC
  // apiUrl: 'http://192.168.1.100:5000'  // si están en PCs distintas
};
```

---

*Forza LATAM — Capacitación IA Sesión 4*
