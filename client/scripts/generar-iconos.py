#!/usr/bin/env python3
"""
Genera los iconos PNG de la PWA en `public/`.

El motivo es el radar de 9 ejes (uno por Dominio) que la app ya usa en la lista
de personas y en el detalle: es el lenguaje visual propio del proyecto, no un
logo genérico. Se dibuja aquí en vez de commitear PNG opacos para que los
iconos sean reproducibles — si cambia el acento del tema, se regeneran con:

    python3 scripts/generar-iconos.py

Requiere Pillow (`pip install Pillow`). No corre en el build: los PNG viven
versionados en public/ y esto solo se ejecuta a mano cuando cambia el diseño.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

# Paleta del tema oscuro (ver src/index.css).
FONDO = (22, 23, 29, 255)  # --bg oscuro #16171d
REJILLA = (60, 62, 76, 255)  # algo más visible que --border, para que se lea al reducir
ACENTO = (192, 132, 252, 255)  # --accent oscuro #c084fc
ACENTO_RELLENO = (192, 132, 252, 64)

EJES = 9  # los 9 DOMINIOS de core/esquema.ts
# Perfil de ejemplo: irregular a propósito, un polígono regular parecería un engranaje.
INTENSIDADES = [3, 2, 3, 1, 2, 3, 2, 1, 2]
INTENSIDAD_MAX = 3

SUPERMUESTREO = 4  # se dibuja a 4x y se reduce con LANCZOS: bordes suaves sin antialias nativo

RAIZ = Path(__file__).resolve().parent.parent
PUBLICO = RAIZ / "public"


def punto(centro: float, radio: float, i: int, intensidad: float) -> tuple[float, float]:
    angulo = -math.pi / 2 + (i * 2 * math.pi) / EJES
    r = (intensidad / INTENSIDAD_MAX) * radio
    return (centro + r * math.cos(angulo), centro + r * math.sin(angulo))


def dibujar(lado: int, fraccion_radio: float) -> Image.Image:
    """`fraccion_radio`: qué parte del medio-lado ocupa el radar. Los iconos
    maskable lo reducen para que nada quede fuera de la zona segura de Android."""
    n = lado * SUPERMUESTREO
    img = Image.new("RGBA", (n, n), FONDO)
    d = ImageDraw.Draw(img)

    centro = n / 2
    radio = centro * fraccion_radio
    grosor = max(1, round(n * 0.006))

    # Anillos concéntricos + radios: la rejilla del radar.
    for nivel in (1, 2, 3):
        d.polygon(
            [punto(centro, radio, i, nivel) for i in range(EJES)],
            outline=REJILLA,
            width=grosor,
        )
    for i in range(EJES):
        d.line([(centro, centro), punto(centro, radio, i, INTENSIDAD_MAX)], fill=REJILLA, width=grosor)

    # El perfil en sí. El relleno translúcido va en su propia capa y se compone
    # encima: ImageDraw.polygon SUSTITUYE el pixel (alfa incluido) en vez de
    # mezclar, y dejaría el interior del icono semitransparente — inaceptable
    # en un maskable, que Android recorta sobre fondo propio.
    perfil = [punto(centro, radio, i, INTENSIDADES[i]) for i in range(EJES)]
    capa = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(capa).polygon(perfil, fill=ACENTO_RELLENO)
    img.alpha_composite(capa)
    d.line(perfil + [perfil[0]], fill=ACENTO, width=grosor * 3, joint="curve")

    # Vértices marcados: dan peso al icono a tamaño pequeño (192px y menos).
    punta = max(2, round(n * 0.016))
    for x, y in perfil:
        d.ellipse([x - punta, y - punta, x + punta, y + punta], fill=ACENTO)

    return img.resize((lado, lado), Image.LANCZOS)


def main() -> None:
    PUBLICO.mkdir(exist_ok=True)
    # `any`: el radar ocupa casi todo. `maskable`: dentro del 80% central que
    # Android garantiza visible sea cual sea la forma del recorte del launcher.
    salidas = [
        ("pwa-192x192.png", 192, 0.78),
        ("pwa-512x512.png", 512, 0.78),
        # 0.62 → radio 158px sobre 512: dentro del círculo seguro de Android
        # (80% del lado = radio 205px) con margen, pero sin quedar diminuto.
        ("maskable-512x512.png", 512, 0.62),
        ("apple-touch-icon-180x180.png", 180, 0.72),
    ]
    for nombre, lado, fraccion in salidas:
        destino = PUBLICO / nombre
        dibujar(lado, fraccion).save(destino, "PNG", optimize=True)
        print(f"{destino.relative_to(RAIZ)}  {lado}x{lado}")


if __name__ == "__main__":
    main()
