# MemSim — Simulador de Administración de Memoria Virtual

Simulador de paginación con algoritmo de reemplazo ARC y despachador Round Robin. Incluye interfaz gráfica paso a paso y soporte para nodos origen remotos vía WebSocket.

## Requisitos

- Node.js 20.x o superior

## Instalación

```bash
npm install
```
#### Recomendado
```bash
npm ci
```
## Uso

```bash
npm start
```

Abre `http://localhost:3000` en el navegador.

### Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT`   | 3000    | Puerto del servidor |
| `FRAMES` | 8       | Total de marcos de memoria |
| `QUANTUM`| 5       | Referencias por quantum |
| `CLOCK`  | 3       | Unidades por ciclo de reloj |

Ejemplo:
```bash
FRAMES=16 QUANTUM=3 npm start
```

## Arquitectura

### Parte 1 — Simulador local

`http://localhost:3000`

- Agrega procesos con nombre, número de páginas y lista de referencias
- Ejecuta paso a paso con el botón **STEP** o la tecla `Espacio`
- Cada step ejecuta una referencia del proceso activo
- Los fallos de página se muestran como alertas
- El botón **ATRÁS** deshace hasta 50 pasos

### Parte 2 — Simulador centralizado

`http://localhost:3000/client`

Cada pestaña o dispositivo que abra `/client` es un nodo origen independiente. El nodo origen envía procesos al servidor y recibe una notificación con los resultados cuando el proceso termina (tiempo de espera, tiempo de terminación, fallos de página).

Para conectar desde otra máquina en la misma red, reemplaza `localhost` con la IP del servidor.

## Algoritmos

**Reemplazo — ARC (Adaptive Replacement Cache)**

Mantiene cuatro listas: T1 y T2 (páginas en memoria) y B1 y B2 (listas fantasma). El parámetro `p` se ajusta dinámicamente según los patrones de acceso para balancear entre páginas usadas recientemente y páginas usadas frecuentemente.

**Despachador — Round Robin**

Quantum de 5 referencias por defecto. Al expirar el quantum, el proceso vuelve al final de la cola lista. Al terminar sus referencias, el proceso se marca como `FINISHED` y se liberan sus marcos.

## Estructura

```
src/
├── core/
│   ├── types.ts        ← Tipos base: PCB, PageTable, MemoryManager, etc.
│   ├── arc.ts          ← Algoritmo ARC
│   ├── dispatcher.ts   ← Round Robin
│   └── simulator.ts    ← Motor del simulador
└── server/
    └── server.ts       ← Express + WebSocket

public/
├── index.html          ← GUI del simulador
└── client.html         ← Nodo origen
```

## Métricas reportadas

Por proceso al terminar:

- **Tiempo de llegada** — ciclo en que fue agregado
- **Tiempo de terminación** — ciclo en que ejecutó su última referencia
- **Tiempo de retorno** — terminación − llegada
- **Tiempo de espera** — retorno − referencias ejecutadas
- **Fallos de página** — total de page faults generados por ese proceso
