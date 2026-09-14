# Gera os ícones do PWA a partir de arte/logo-original.jpeg.
#
#   gdk-pixbuf-thumbnailer -s 1024 arte/logo-original.jpeg /tmp/fonte.png
#   python3 arte/gerar-icones.py /tmp
#   cp /tmp/nome-{192,512,180}.png  ->  public/icone-{192,512,apple}.png
#
# A máquina não tem PIL nem ImageMagick, e o Python está sem pip: por isso o
# PNG é decodificado e gravado na mão (arte/png.py).

import sys
sys.path.insert(0, sys.argv[1])
from png import ler_png, salvar_png
SP = sys.argv[1]
w, h, c, px = ler_png(SP + '/fonte.png')

X0, Y0, LADO = 198, 71, 632
# Bloco do logo: símbolo no topo + wordmark embaixo, medidos por cor.
CX0, CY0, CW, CH = 252, 127, 516, 512   # medido ignorando o bisel da borda
i = ((Y0 + int(LADO * 0.75)) * w + (X0 + LADO // 2)) * c
NAVY = (px[i], px[i+1], px[i+2])

def media(sx0, sy0, sx1, sy1):
    r = g = b = n = 0
    for sy in range(max(sy0, 0), min(sy1, h)):
        base = sy * w * c
        for sx in range(max(sx0, 0), min(sx1, w)):
            j = base + sx * c
            r += px[j]; g += px[j+1]; b += px[j+2]; n += 1
    if not n:
        return NAVY
    r, g, b = r // n, g // n, b // n
    # O fundo do logo original tem gradiente e bisel; colado sobre o navy
    # chapado, isso desenha um retângulo fantasma. Em vez de recortar um
    # bloco, misturamos cada pixel com o navy conforme o quanto ele se
    # destaca do fundo — o desenho entra, o fundo some, e as bordas
    # suavizadas do logo continuam suaves.
    brilho = 0.3 * r + 0.6 * g + 0.1 * b
    t = (brilho - 58) / 40.0
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    if t <= 0:
        return NAVY
    return (round(NAVY[0] + (r - NAVY[0]) * t),
            round(NAVY[1] + (g - NAVY[1]) * t),
            round(NAVY[2] + (b - NAVY[2]) * t))

def compor(T, ocupacao=0.80):
    out = bytearray()
    for _ in range(T * T):
        out.extend(NAVY)
    larg = int(T * ocupacao)
    alt = int(larg * CH / CW)
    if alt > T * ocupacao:                       # se ficar alto demais, limita pela altura
        alt = int(T * ocupacao); larg = int(alt * CW / CH)
    ox, oy = (T - larg) // 2, (T - alt) // 2
    ex, ey = CW / larg, CH / alt
    for dy in range(alt):
        for dx in range(larg):
            cor = media(int(CX0 + dx * ex), int(CY0 + dy * ey),
                        int(CX0 + (dx + 1) * ex) + 1, int(CY0 + (dy + 1) * ey) + 1)
            k = ((oy + dy) * T + ox + dx) * 3
            out[k], out[k+1], out[k+2] = cor
    return out

for T in (512, 192, 180):
    salvar_png(f'{SP}/nome-{T}.png', T, T, compor(T))
print('ok  navy:', NAVY)
