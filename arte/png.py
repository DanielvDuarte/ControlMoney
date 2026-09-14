import zlib, struct

def ler_png(caminho):
    d = open(caminho, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, info = 8, bytearray(), None
    while pos < len(d):
        tam = struct.unpack('>I', d[pos:pos+4])[0]
        tipo = d[pos+4:pos+8]
        dados = d[pos+8:pos+8+tam]
        if tipo == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', dados[:10])
            info = (w, h, bd, ct)
        elif tipo == b'IDAT':
            idat += dados
        elif tipo == b'IEND':
            break
        pos += 12 + tam
    w, h, bd, ct = info
    assert bd == 8 and ct in (2, 6), f'formato nao suportado: bd={bd} ct={ct}'
    canais = 3 if ct == 2 else 4
    bruto = zlib.decompress(bytes(idat))
    linha_bytes = w * canais
    saida = bytearray(h * linha_bytes)
    ant = bytearray(linha_bytes)
    p = 0
    for y in range(h):
        filtro = bruto[p]; p += 1
        atual = bytearray(bruto[p:p+linha_bytes]); p += linha_bytes
        if filtro == 1:
            for i in range(canais, linha_bytes):
                atual[i] = (atual[i] + atual[i-canais]) & 255
        elif filtro == 2:
            for i in range(linha_bytes):
                atual[i] = (atual[i] + ant[i]) & 255
        elif filtro == 3:
            for i in range(linha_bytes):
                a = atual[i-canais] if i >= canais else 0
                atual[i] = (atual[i] + ((a + ant[i]) >> 1)) & 255
        elif filtro == 4:
            for i in range(linha_bytes):
                a = atual[i-canais] if i >= canais else 0
                b = ant[i]
                c = ant[i-canais] if i >= canais else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                atual[i] = (atual[i] + pr) & 255
        saida[y*linha_bytes:(y+1)*linha_bytes] = atual
        ant = atual
    return w, h, canais, saida

def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

def salvar_png(caminho, w, h, rgb):
    linhas = bytearray()
    for y in range(h):
        linhas.append(0)
        linhas.extend(rgb[y*w*3:(y+1)*w*3])
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(linhas), 9))
           + chunk(b'IEND', b''))
    open(caminho, 'wb').write(png)
