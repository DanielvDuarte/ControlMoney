# Como este projeto está montado

Documento de referência do que está configurado, onde, e por quê. O
[README](README.md) explica como reproduzir a instalação do zero; este aqui
descreve **esta** instalação — endereços reais, decisões tomadas e os erros que
apareceram no caminho.

Última atualização: 14/09/2026.

---

## Visão geral

O app é um front estático em React + Vite. Não existe servidor próprio: o
navegador fala direto com o Supabase, que faz o papel de banco e de
autenticação ao mesmo tempo.

```
navegador (celular / PC)
      │
      │  HTTPS
      ▼
GitHub Pages  ──── serve HTML/JS estático (o build do Vite)
      │
      │  chamadas da biblioteca supabase-js
      ▼
Supabase  ──── Postgres + Auth + Realtime
      │
      └──── Google OAuth (só no momento do login)
```

Consequência prática: **não há segredo no front**. Qualquer pessoa pode ler o
JavaScript publicado e extrair a URL do projeto e a chave publishable. Quem
protege os dados é o RLS do Postgres — sem uma sessão válida, as policies não
retornam nenhuma linha. Por isso o repositório pode ser público sem risco.

## Endereços

| O quê | Onde |
|---|---|
| App publicado | https://danielvduarte.github.io/ControlMoney/ |
| Repositório | https://github.com/DanielvDuarte/ControlMoney |
| Projeto Supabase | `padupthxxxmnrkvjfyso` |
| API do Supabase | https://padupthxxxmnrkvjfyso.supabase.co |
| Callback OAuth | https://padupthxxxmnrkvjfyso.supabase.co/auth/v1/callback |
| Projeto Google Cloud | `ControlMoney` |

---

## 1. Supabase

**Banco.** O [schema.sql](schema.sql) foi executado uma vez no SQL Editor. Ele
cria as três tabelas (`categorias`, `meses`, `gastos`), liga RLS em todas,
cria as policies por `user_id` e instala o gatilho `on_auth_user_created_seed`
em `auth.users`, que cadastra a categoria inicial (Casa) em cada conta nova —
inclusive contas criadas via Google.

Se o `schema.sql` for alterado depois (como no caso do seed, que já foi
enxugado uma vez), rode só o trecho alterado no SQL Editor: o `create or
replace function` substitui a versão antiga sem tocar nos dados. E lembre que
o gatilho só age em contas **novas** — contas existentes ficam com as
categorias que receberam no dia em que foram criadas.

Rodar esse script devolve *"Success. No rows returned"*. É o esperado: ele cria
estruturas, não consulta dados.

**Chaves.** Em Project Settings → API Keys, o projeto usa o formato novo:

- **Publishable key** (`sb_publishable_…`) — vai no front. Segura no navegador
  justamente porque o RLS está ligado.
- **Secret key** (`sb_secret_…`) — ignora o RLS. Nunca sai do painel do
  Supabase. Não está no GitHub, não está no front, não deve ir para lugar nenhum.

O código procura a publishable key na variável `VITE_SUPABASE_ANON_KEY`
([src/lib/supabase.js](src/lib/supabase.js)). O nome ficou com "ANON" por
herança do formato antigo; é só um rótulo.

**URL Configuration** (Authentication → URL Configuration):

- Site URL: `https://danielvduarte.github.io/ControlMoney/`
- Redirect URLs: `https://danielvduarte.github.io/ControlMoney/**`

Isso governa para onde o usuário volta depois do login pelo Google e para onde
apontam os links de confirmação de e-mail e de recuperação de senha.

## 2. Google OAuth

**No Google Cloud** (projeto `ControlMoney`, Google Auth Platform):

- Consent screen configurado como **Externo**, em modo *Testing* — só os e-mails
  listados em **Público-alvo → Usuários de teste** conseguem entrar.
- Um cliente OAuth do tipo **Aplicativo da Web** (`Cliente Web 1`), com o
  callback do Supabase em **URIs de redirecionamento autorizados**.
- Origens JavaScript autorizadas: vazio. O fluxo é servidor-a-servidor entre
  Supabase e Google; o navegador não chama a API do Google diretamente.

**No Supabase** (Authentication → Sign In / Providers → Google): provider
ativado, com o Client ID e o Client Secret do cliente acima.

Tudo isso é gratuito. Login com Google não tem cobrança por usuário nem exige
cartão; billing no Google Cloud só entra em serviços de infraestrutura, que
este projeto não usa.

Para liberar outra pessoa (a Brenda, por exemplo), basta adicionar o Gmail dela
em **Público-alvo → Usuários de teste**. O limite do modo Testing é 100 contas.

## 3. GitHub Pages

O deploy é automático via Actions: todo `push` na `main` dispara o
[.github/workflows/deploy.yml](.github/workflows/deploy.yml), que instala Node,
roda `npm run build` e publica a pasta `dist/`. O build acontece nos servidores
do GitHub — **não é preciso ter Node instalado na máquina** para publicar.

Duas configurações no repositório sustentam isso:

1. **Settings → Pages → Source: GitHub Actions.** Sem isso o passo
   `configure-pages` falha e nada é publicado.
2. **Settings → Secrets and variables → Actions → aba Variables**, com
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Precisa ser a aba
   *Variables*, porque o workflow lê `${{ vars.* }}`; o que estiver em *Secrets*
   ele não enxerga.

O Vite grava essas variáveis dentro do JavaScript no momento do build. Alterar
uma delas exige **rodar o workflow de novo** — mudar a variável sozinha não
afeta um deploy já publicado.

O `base: "/ControlMoney/"` do [vite.config.js](vite.config.js) existe porque no
GitHub Pages o site fica em `usuario.github.io/<repo>/`, não na raiz do domínio.
Sem ele, o HTML procuraria os arquivos em `/assets/…` e a tela abriria preta.

---

## A funcionalidade "Analisar no Claude"

Decisão de arquitetura que vale registrar, porque a alternativa óbvia era outra.

O app **não chama a API do Claude**. Ele monta o texto do mês, oferece um botão
de copiar e um link para o claude.ai; a pessoa cola lá, na conta dela, e traz a
resposta de volta num campo que guarda o texto na tabela `analises`.

Por que assim, e não uma Edge Function chamando a API:

- **A API do Claude não tem camada gratuita** — é crédito pré-pago. O plano
  grátis do claude.ai é só a interface de conversa, e não existe forma
  legítima de um app terceiro consumi-la por baixo dos panos.
- **Custo zero** para todo mundo, e nenhuma chave de API para guardar.
- **Privacidade**: os dados financeiros não saem do projeto por iniciativa do
  app. Quem envia é a pessoa, conscientemente, colando no chat dela.

O preço disso é o passo manual (copiar / colar / colar de volta). Se um dia
fizer sentido automatizar, o caminho é uma Edge Function do Supabase com a
chave como secret — e ela reaproveita o mesmo `montarResumo()` que já existe
em [src/App.jsx](src/App.jsx). Nunca coloque uma chave de API no front: o
bundle é público.

A qualidade da análise depende inteiramente de `montarResumo()`. É lá que se
mexe para melhorar o resultado, não no prompt que a pessoa digita.

## A importação de OFX

Também roda inteiramente no navegador — o arquivo do extrato não sobe para
lugar nenhum. O parse está em `lerOFX()` em [src/App.jsx](src/App.jsx).

Dois detalhes que não são óbvios e vão morder quem for mexer:

- **OFX é SGML, não XML.** As tags de valor não fecham (`<TRNAMT>-750.00` e
  segue a linha), então um parser de XML engasga. Por isso a leitura é por
  expressão regular, bloco a bloco de `<STMTTRN>`.
- **Codificação.** Bancos brasileiros costumam gerar o arquivo em
  windows-1252. Lido como UTF-8, todo acento vira `�`. `lerArquivoTexto()`
  tenta UTF-8, detecta o caractere de substituição e relê como windows-1252.

Contra importação duplicada, cada gasto importado guarda o `FITID` da
transação na coluna `gastos.fitid`. Antes de mostrar a lista, o app consulta
quais desses ids já existem e bloqueia essas linhas. Gastos digitados à mão
ficam com `fitid` nulo.

A sugestão de categoria vem do histórico: `chaveDesc()` normaliza a descrição
(tira acento, número e símbolo), então "PAG*ASSAI 1234" e "PAG*ASSAI 9876"
caem na mesma chave, e a categoria usada da última vez vem pré-selecionada.

Tudo entra como **pago**, já que saiu do extrato, e vai para o mês da própria
transação — não para o mês aberto na tela. Um extrato que cruza a virada do mês
distribui os lançamentos corretamente.

## Editar um gasto parcelado

Um gasto em N parcelas são N linhas no banco, ligadas pelo `grupo_parcela`.
Editar qualquer uma delas **reescreve a série inteira**, a partir do mês da
primeira parcela — é o que permite corrigir "esqueci que eram 5x" ou "digitei
o valor total em vez do mensal" sem apagar e relançar.

A reescrita preserva o que não deve se perder:

- **`pago` por posição** — se a parcela 1 e a 2 estavam pagas, continuam pagas
  depois da edição, mesmo que o valor ou a quantidade mude.
- **`fitid`** fica na primeira linha, para não reabrir a porta a uma
  reimportação duplicada.
- **`fixo_id`** idem. Perder esse vínculo custaria caro: além do selo, é ele
  que alimenta o índice único `(user_id, mes, fixo_id)` — sem ele, o mês
  poderia receber uma segunda cópia da mesma conta fixa.
- Reduzir a quantidade descarta as parcelas excedentes; aumentar cria as novas
  nos meses seguintes.

A ordem das operações é **inserir e depois apagar**, nunca o contrário: se o
insert falhar, o usuário vê o erro e os dados antigos continuam lá. Não é uma
transação — o Supabase pelo cliente não dá atomicidade aqui —, então o pior
caso é ficar com a série duplicada, o que é visível e corrigível, em vez de
perder o gasto.

## PWA: o convite para instalar

Três peças, todas em `public/`, registradas por `src/main.jsx`:

- **`manifest.webmanifest`** — nome, cores e ícones. Os caminhos são relativos
  (`"start_url": "./"`), o que faz o mesmo arquivo funcionar tanto em
  `/ControlMoney/` quanto na raiz de outro host.
- **`sw.js`** — service worker. O navegador só oferece instalação para sites
  que têm um. Ele usa **rede primeiro** para a navegação: assim o app nunca
  fica preso numa versão antiga depois de um deploy. Os assets, que têm hash
  no nome, ficam em cache sem risco. Chamadas ao Supabase e às fontes do
  Google nunca passam pelo cache.
- **Ícones PNG** derivados do logo do ControlMoney. A máquina não tem PIL,
  ImageMagick nem `pip`, então o caminho foi: `gdk-pixbuf-thumbnailer`
  (que existe no sistema) converteu o JPEG original para PNG, e um script
  Python decodificou, recortou e redimensionou na mão — zlib para o
  descompactar, um passe pelos cinco filtros do PNG, média de área para
  reduzir, e zlib de novo para gravar.

  O ícone traz o símbolo **e** o nome, para não se confundir com os vários
  apps de finanças de logo parecida. O bloco ocupa 80% do quadrado — dentro
  da zona segura das máscaras circulares do Android, para as letras não serem
  cortadas — sobre o navy `#1a3258` do logo.

  O detalhe que deu trabalho: colar o recorte sobre um navy chapado desenhava
  um retângulo fantasma, porque o fundo do logo original tem gradiente e um
  bisel na borda. A solução foi não colar um bloco: cada pixel é misturado
  com o navy conforme o quanto se destaca do fundo, então o desenho entra, o
  fundo some e as bordas suavizadas continuam suaves.

  Para regerar (se o logo mudar), veja o cabeçalho de
  [arte/gerar-icones.py](arte/gerar-icones.py).

- **`public/marca.png`** é o mesmo símbolo **sem o texto**, usado no cabeçalho
  do app e na tela de login. Ali o nome já vem escrito ao lado, e o texto do
  logo ficaria ilegível a 24px.

O manifest e o service worker são injetados em `main.jsx` em vez de declarados
no `index.html` de propósito: eles precisam do `import.meta.env.BASE_URL`, e
assim não dependem de como o Vite reescreve (ou não) `href` no HTML.

O convite em si é o componente `ConviteInstalar`, renderizado **na tela de
login e no painel** — quem ainda não entrou também precisa vê-lo.

Ele aparece sempre, e o botão automático é um bônus, não a condição. Sem o
evento, o convite mostra a instrução manual do navegador em uso
(`dicaInstalacao()`): menu ⋮ no Android, botão Compartilhar no iPhone, ícone
da barra de endereço no computador. O Firefox nunca oferece instalação.

**A armadilha do `beforeinstallprompt`:** ele costuma disparar durante o
carregamento da página, **antes do React montar**. Um listener registrado
dentro do componente chega tarde e perde o evento para sempre naquela visita —
o sintoma é o convite aparecer sempre no modo manual, como se o navegador não
suportasse instalação. Por isso o listener de verdade fica em
[src/main.jsx](src/main.jsx), antes do `createRoot`: ele guarda o evento em
`window.__promptInstalar` e emite um `prompt-instalar-pronto`. O componente lê
a variável ao montar e também escuta esse aviso, cobrindo as duas ordens
possíveis. O evento só pode ser consumido uma vez, então é zerado depois do
`prompt()`.

Ele some para sempre em três casos: o app já está instalado
(`display-mode: standalone`), a pessoa instalou (`appinstalled`), ou a pessoa
dispensou (marca em `localStorage`, dentro de try/catch por causa da navegação
privativa).

Para depurar "o convite não aparece", o caminho mais rápido é o console do
navegador, na página publicada:

```js
matchMedia("(display-mode: standalone)").matches   // true = já instalado
localStorage.getItem("convite-instalar-dispensado") // "1" = dispensado antes
window.__promptInstalar                             // null = o navegador não ofereceu
```

O `background_color` do manifest é o navy do ícone (a tela de abertura fica
coerente com ele), e o `theme_color` segue o `#0a0e16` do app, para a barra de
status não mudar de cor quando o app termina de carregar.

## Temas claro e escuro

As cores não ficam mais espalhadas pelo `S` do [src/App.jsx](src/App.jsx): são
variáveis CSS declaradas em [index.html](index.html), num bloco por tema.
Trocar de tema é só mudar `data-tema` na tag `<html>` — o navegador repinta
tudo sozinho, sem re-render do React e sem recarregar a página.

Mexendo nas cores, **mexa no index.html**, não no componente. Os estilos usam
`var(--nome)`; um hex solto no `S` vira uma cor que não acompanha o tema.

Ficaram fixas de propósito as cores de marca: a paleta `CORES_CAT` das
categorias, as quatro cores do logo do Google e o laranja do botão do Claude.
Elas são as mesmas nos dois temas — o botão branco do Google ganhou uma borda
justamente porque, no tema claro, sumiria contra o fundo.

O tema salvo é aplicado por um script inline no `<head>`, **antes** da primeira
pintura. Se ficasse só no React, quem escolheu o tema claro veria um lampejo
escuro a cada abertura. O mesmo handler atualiza a meta `theme-color`, para a
barra do navegador no celular acompanhar.

## O que acontece sem internet

O service worker guarda a casca do app (HTML e JavaScript), então ele **abre**
offline e a sessão de login sobrevive — o token fica no navegador. Mas os
dados vivem no Supabase e vêm pela rede: sem conexão, nenhuma consulta volta.

O app **não funciona offline**, e o cuidado aqui é dizer isso com clareza.
Antes, a falha caía num `setGastos([])` e a tela anunciava "nenhum gasto neste
mês" — indistinguível de um mês realmente vazio, como se os lançamentos
tivessem sumido. Um app de contas não pode dar esse susto.

Agora `carregarMes()` captura o erro e liga `falhaRede`; nesse estado o painel
inteiro (saldo, resumo, lista, botão de novo gasto) dá lugar ao componente
`SemDados`, que diz o que houve e garante que os dados estão salvos. Nada de
cards zerados: `R$ 0,00` em toda parte mentiria tanto quanto a lista vazia.

A distinção entre "sem conexão" e "servidor fora do ar" vem de
`navigator.onLine`, e serve só para escolher a frase — a tela aparece nos dois
casos, porque `navigator.onLine` mente com frequência (dá `true` para quem
está num Wi-Fi sem internet). Quem decide é a falha da consulta; o
`navigator.onLine` só ajusta o texto.

Um listener de `online` recarrega sozinho quando a conexão volta, sem exigir
toque.

## A data do gasto

`gastos.data` é o dia em que o gasto aconteceu; `gastos.mes` continua sendo o
mês a que ele pertence. Os dois são redundantes de propósito: `mes` é a chave
de tudo no app (navegação, consultas, parcelas) e mexer nisso por causa de um
campo novo seria trocar o motor com o carro andando.

Por isso o seletor de data é **limitado ao mês aberto** (`min`/`max` no
input). Escolher 30/08 enquanto se olha setembro deixaria os dois campos
contradizendo um ao outro — ou faria o gasto sumir da tela ao ser salvo, o que
é pior. Para lançar em agosto, navega-se até agosto.

Duas armadilhas resolvidas nos helpers:

- **`hojeISO()` monta a data do relógio local**, campo a campo.
  `new Date().toISOString().slice(0,10)` devolveria UTC e, depois das 21h no
  horário de Brasília, gravaria o dia seguinte.
- **`diaEm()` limita o dia ao último do mês.** Uma compra em 31/01 parcelada
  em 3x cairia em 31/02 e 31/04, que não existem; ela vira 28/02 e 30/04.

A importação de OFX preenche a data com a da própria transação, e o resumo
levado ao Claude passa a mostrar `14/09 — Aluguel`, o que lhe dá a
distribuição dos gastos ao longo do mês.

Linhas antigas ficam com `data` nula e vão para o fim da lista
(`nullsFirst: false`), sem quebrar nada.

## Contas fixas

Conta fixa não é parcelamento: não tem fim, e o valor varia (água e luz mudam
todo mês; aluguel não). Por isso ela **não** gera parcelas adiantadas — não
existe "infinitas parcelas".

O que existe é um **molde** na tabela `fixos`. Quando um mês é aberto pela
primeira vez, `gerarFixos()` cria um gasto para cada molde ativo e marca
`meses.fixos_gerados`. Os lançamentos ficam amarrados ao molde por
`gastos.fixo_id`.

Três detalhes que sustentam o desenho:

- **O sinalizador `fixos_gerados` é o que permite apagar.** Sem ele, apagar a
  conta de luz de um mês a faria ressuscitar na próxima abertura, e não haveria
  como se livrar dela.
- **Índice único `(user_id, mes, fixo_id)`** protege contra o celular e o
  computador abrindo o mesmo mês ao mesmo tempo: o segundo `upsert` com
  `ignoreDuplicates` não cria nada. Gastos comuns têm `fixo_id` nulo, e no
  Postgres nulos não colidem entre si, então o índice não atrapalha o resto.
- **Parar uma conta fixa não mexe no passado.** A FK é `on delete set null`:
  os lançamentos já feitos continuam, só perdem o selo. Existe também um
  `ativo` para pausar sem apagar — útil para algo suspenso por uns meses.
- **Meses futuros já abertos são o caso traiçoeiro.** Quem navegou até dezembro
  em algum momento já tem o lançamento criado lá, e parar o modelo não alcança
  isso. Por isso `removerFixo()` procura lançamentos daquele molde em meses
  posteriores ao aberto **e ainda não pagos**, lista os meses e pergunta se
  devem ir junto. Pagos nunca são tocados: são fato consumado.

A caixa "Repetir todo mês" aparece tanto ao criar quanto ao **editar** — é
comum lembrar depois que aquilo se repete. Marcá-la num gasto existente cria o
molde e amarra o lançamento a ele. Quando o lançamento já vem de uma conta
fixa, a caixa dá lugar a um aviso apontando para a tela de Contas fixas: parar
uma conta fixa tem regras próprias (limpeza dos meses futuros não pagos) e não
faria sentido duplicar isso aqui.

**O molde não guarda valor, e isso é deliberado.** Água e luz mudam todo mês;
aluguel muda com reajuste; qualquer conta muda se for paga com atraso e juros.
Um valor herdado seria preenchido de véspera e passaria batido justamente nos
meses em que veio diferente — o registro ficaria bonito e errado. Por isso o
lançamento nasce em `R$ 0,00`, e a lista mostra um selo **a preencher** no
lugar do valor, que abre a edição ao ser tocado. Um mês com pendências fica
visível de relance.

O lançamento do mês é um gasto comum: editá-lo não altera o molde, e alterar o
molde não reescreve meses já abertos. O histórico é registro do que aconteceu,
não uma projeção recalculável.

## Falhas silenciosas no salvamento

`salvarGasto()` é o caminho mais longo do app: cria categoria se preciso,
registra subcategoria, monta N parcelas, pode criar um molde de conta fixa.
Qualquer erro no meio quebrava a promessa sem que ninguém escutasse — o modal
ficava parado e o botão parecia morto.

Agora o caminho inteiro está dentro de um `try/catch` que joga a mensagem em
`erroGlobal`, exibida no próprio modal. `garantirCategoria()` também deixou de
devolver `undefined` em caso de erro: ela lança, com o nome da categoria na
mensagem.

A regra vale para o resto do código: **toda escrita no Supabase deve checar
`error`**. O cliente não lança sozinho — ele devolve `{ data: null, error }`, e
ignorar isso produz exatamente esse tipo de bug mudo.

Relacionado: os botões do modal são `position: sticky` no rodapé. O formulário
de gasto cresceu ao longo do tempo e, no celular, "Adicionar" caía abaixo da
dobra — indistinguível de um botão que não funciona.

## Renomear categoria e subcategoria

São dois casos com custos bem diferentes, e o código trata cada um do seu jeito.

**Categoria** é barato: `gastos.categoria_id` aponta para o id, nunca para o
nome. Trocar `categorias.nome` é um `update` numa linha e todos os gastos
acompanham. O único tropeço possível é a restrição `unique (user_id, nome)`,
e a mensagem de erro é traduzida para "já existe uma categoria chamada X".

**Subcategoria** é caro: ela vive em dois lugares — no array
`categorias.subs` e, copiada, em cada `gastos.subcategoria`. Renomear só no
array deixaria os lançamentos antigos com o nome velho, órfãos de qualquer
filtro. Por isso `renomearSub()` faz as duas escritas: atualiza o array e
depois `update gastos set subcategoria = novo where categoria_id = … and
subcategoria = antigo`.

Essa duplicação é herança do modelo original (subcategoria como texto solto,
sem tabela própria). Vale a pena saber disso antes de mexer: qualquer operação
sobre nomes de subcategoria precisa lembrar dos dois lados.

## Exportar em PDF

Não há biblioteca de PDF no projeto. O botão chama `window.print()`, e quem
gera o arquivo é o próprio navegador — "Salvar como PDF" no computador, a
folha de compartilhamento no celular. Zero dependência, e funciona em tudo.

O que torna isso apresentável é o par de peças em [index.html](index.html) e
`FolhaImpressao`:

- A interface do app leva `className="nao-imprimir"` e some no `@media print`.
- `#folha` fica `display: none` na tela e aparece só na impressão.
- A folha usa **cores fixas, preto no branco**, ignorando o tema. Imprimir a
  interface escura gastaria tinta e ficaria ilegível.
- `break-inside: avoid` nas linhas e nos grupos evita uma categoria partida ao
  meio entre duas páginas.

Se um dia for preciso um PDF gerado no servidor (envio automático por e-mail,
por exemplo), aí sim entra biblioteca — mas para "minha esposa quer ver ou
imprimir", a impressão do navegador resolve sem custo nenhum.

## Entradas avulsas

`meses.renda` continua sendo a renda fixa. A tabela `entradas` guarda o resto:
bico, reembolso, venda. O app calcula `rendaTotal = renda + soma(entradas)`, e
**tudo o que dependia de renda passou a depender dessa soma** — o saldo, a
barra de comprometimento e as porcentagens por categoria. Ao mexer nesse
cálculo, procure por `rendaTotal`, não por `renda`.

## Rotina de manutenção

**Alterar o app:** edite, `git push`, e o deploy sai sozinho em ~1 minuto.
Acompanhe na aba **Actions**.

**Republicar sem alterar código:** Actions → *Deploy no GitHub Pages* →
**Run workflow**. Útil depois de mudar uma variável.

**Rodar local** (só para desenvolver; exige Node 18+):

```bash
cp .env.example .env    # preencha URL e publishable key
npm install
npm run dev
```

Para o login pelo Google funcionar local, adicione `http://localhost:5173/**`
nas Redirect URLs do Supabase.

**Trocar o segredo do Google:** Google Cloud → Clientes → Cliente Web 1 → criar
nova chave secreta → atualizar no Supabase → apagar a antiga.

---

## Problemas conhecidos e como reconhecê-los

| Sintoma | Causa | Correção |
|---|---|---|
| Tela preta, console reclama de variáveis faltando | build saiu sem as variables | cadastrar em *Variables* (não *Secrets*) e rodar o workflow de novo |
| Actions falha em `configure-pages` | Pages não está em "GitHub Actions" | Settings → Pages → Source |
| Site mostra o repositório ou dá 404 | Pages em "Deploy from a branch" | idem; esse modo serve os arquivos crus, e JSX o navegador não executa |
| `redirect_uri_mismatch` no Google | URI de callback errado no cliente OAuth | tem que ser o do **Supabase**, `…/auth/v1/callback`, sem barra no fim |
| "Origem inválida" ao salvar no Google Cloud | callback colado em *Origens JavaScript* | ele vai em *URIs de redirecionamento*; origens não aceitam caminho |
| Google diz "app não verificado" | e-mail fora da lista de teste | Público-alvo → Usuários de teste |
| Login pelo Google volta para a página errada | Site URL / Redirect URLs desatualizadas | Authentication → URL Configuration |
| Card do topo vermelho com "Faltam" | renda do mês não informada | botão *Renda* no card; o saldo é `renda − total` |
| Gastos aparecem em "Sem categoria" | a categoria deles foi apagada | normal: a FK é `on delete set null`, os valores continuam certos. Edite o gasto para escolher outra |

Sobre o último: o vermelho não tem relação com o tique de "pago". Os campos
*Já pago* e *Falta pagar* é que respondem ao tique. O card grande compara a
renda do mês com o total de gastos, e cada mês guarda a sua própria renda.

## Avisos benignos

O Actions mostra dois warnings amarelos sobre "Node.js 20 is deprecated". São
sobre o runtime interno das actions do GitHub (`checkout`, `setup-node`,
`deploy-pages`), não sobre este projeto. Nada quebra; somem quando o GitHub
lançar as versões novas dessas actions.

Ponto em aberto: o `node-version: 20` do workflow — esse sim é o Node que
compila o projeto — está numa versão fora do suporte desde abril de 2026.
Trocar para 22 é uma linha, e vale fazer junto da próxima alteração.
