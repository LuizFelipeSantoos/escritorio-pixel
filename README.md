# Pixel Office

Um escritório em pixel art onde cada skill do seu Claude Code vira um personagem com mesa. Quando você roda uma skill, o personagem levanta, vai pra mesa e mostra o que está fazendo.

## Comece em 3 minutos

**Você precisa de:** Node.js 22.13 ou mais novo (`node -v` pra conferir) e o Claude Code instalado. Nada de `npm install`: o servidor só usa o que já vem no Node.

### 1. Baixe e ligue o escritório

```bash
git clone https://github.com/LuizFelipeSantoos/escritorio-pixel.git ~/Documents/pixel-office
```

```bash
node ~/Documents/pixel-office/server.mjs
```

Abra http://127.0.0.1:4777. Deixe esse terminal aberto enquanto usa o escritório.

### 2. Veja suas skills ganharem mesa

O escritório lê a pasta `~/.claude/skills`. Cada pasta com um `SKILL.md` vira um personagem em até 30 segundos, sem reiniciar nada.

- Pasta vazia = escritório vazio. Instale ou crie uma skill e ela aparece.
- 2 ou mais skills com o mesmo começo de nome ganham uma sala só delas. Ex.: `prospeccao-busca` e `prospeccao-email` criam a sala **prospeccao**. Uma skill sozinha senta na sala geral.

Pra testar agora, crie uma skill de exemplo:

```bash
mkdir -p ~/.claude/skills/prospeccao-busca && printf -- '---\nname: prospeccao-busca\ndescription: Busca empresas pra prospectar.\n---\n\nListe 5 tipos de empresa locais que costumam contratar marketing.\n' > ~/.claude/skills/prospeccao-busca/SKILL.md
```

### 3. Ligue os hooks (é isso que faz os personagens trabalharem)

Sem os hooks, os personagens ficam parados nas mesas. Abra `~/.claude/settings.json` e cole o bloco `"hooks"` da seção [Ver as skills trabalhando](#ver-as-skills-trabalhando-hooks) lá embaixo (dentro das chaves principais, ao lado do que já existir). Se o escritório estiver desligado, o hook falha em silêncio em menos de 1 segundo e não atrapalha nada.

### 4. Veja funcionando

Num Claude Code novo, rode:

```text
/prospeccao-busca
```

O personagem da skill levanta, vai pra mesa e mostra cada ferramenta que está usando. Quando termina, volta ao normal.

### Personalizar (opcional)

- **Sala, cor e nome de um personagem:** crie `agents.json` na pasta do escritório, por exemplo `{"prospeccao-busca": {"room": "vendas", "label": "Caçador", "color": "#ff7a59"}}`. Copie `agents.example.json` como ponto de partida. O `agents.json` e o `descricoes.json` são seus e ficam fora do git.
- **Clique num personagem** pra ver o que ele está fazendo ou pedir algo a ele (roda a skill com acesso só de leitura).
- **Porta diferente:** `PORT=5000 node ~/Documents/pixel-office/server.mjs`.

Os móveis são do pacote [Isometric Home Furniture](https://sweeetpotatoo.itch.io/isometric-home-furniture), da Sweeetpotatoo (licença livre), mais desenhos próprios gerados por `scripts/build-iso-sprites.mjs`.

---

## Reference (English)

A pixel-art office where every skill in `~/.claude/skills` gets a desk, plus Harvey at the Sales Floor. Skills named `li-*` stay out of the office.

```bash
node ~/Documents/pixel-office/server.mjs
```

Open http://127.0.0.1:4777.

- **New skill?** Create the folder in `~/.claude/skills/<name>/SKILL.md` and it shows up within 30 seconds. Two or more skills that share a prefix get their own room. A single skill sits with the rest. Rooms are drawn only when someone has a desk there. Folders named `li-*` are ignored.
- **Your name** comes from the system user and is stored in `office.json` (not committed).
- **Change room/color/name**: create `agents.json` here, e.g. `{"minha-skill": {"room": "codigo", "label": "Minha Skill", "color": "#ff7a59"}}`. A `room` value is an exception for that one skill. The room appears because that skill sits in it.
- **Click a character**: see what it is doing, ask it for something (runs `claude -p "/<skill> ..."` with read-only access) and copy the result.
- **Harvey**: reads `~/Documents/harvey/data/harvey.db` (read only). Ligar/Desligar uses Harvey's dashboard (`harvey dashboard`, port 5555). E-mails still need approval in the Outbox there.

## Ver as skills trabalhando (hooks)

Seeing skills you use in Claude Code:

Add this `hooks` block to `~/.claude/settings.json` (next to `enabledPlugins`). If the server is off, the hook fails silently in under a second.

```json
"hooks": {
  "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'Content-Type: application/json' -H 'X-Office: 1' --data-binary @- http://127.0.0.1:4777/hook >/dev/null 2>&1 || true" }] }],
  "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'Content-Type: application/json' -H 'X-Office: 1' --data-binary @- http://127.0.0.1:4777/hook >/dev/null 2>&1 || true" }] }],
  "Stop":             [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'Content-Type: application/json' -H 'X-Office: 1' --data-binary @- http://127.0.0.1:4777/hook >/dev/null 2>&1 || true" }] }],
  "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'Content-Type: application/json' -H 'X-Office: 1' --data-binary @- http://127.0.0.1:4777/hook >/dev/null 2>&1 || true" }] }]
}
```
