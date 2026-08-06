# 📱 Agente Financeiro — Guia de Instalação e Venda

> Documento para você (dono/vendedor) e para os clientes (família/terceiros).
> Cada pessoa usa o **seu próprio espaço privado** — sem login, sem senha, sem cadastro.

---

## 1. Como funciona (o modelo de venda)

| Pergunta | Resposta |
|---|---|
| Precisa de login/cadastro? | **Não.** Cada pessoa cria o **seu espaço** com 1 toque |
| Como acesso meus dados em outro aparelho? | Ativo o espaço com o **mesmo código** nos aparelhos que são **meus** |
| Outra pessoa vê meus dados? | **Não.** Cada código = um espaço separado e criptografado |
| Quem lê meus dados? | **Só eu.** Os dados são criptografados no aparelho antes de ir à nuvem |
| Preço? | O que você definir — o app não cobra nada por uso |

**Dica de venda:** cada cliente gera o próprio código na primeira abertura. O código dele é a "chave do espaço" — se ele quiser, pode usar em vários aparelhos (celular + tablet + computador) com o mesmo código. Ninguém mais precisa saber o código dele.

---

## 2. Instalar no iPhone (PWA — vira um app na tela de início)

1. Abra o **Safari** no iPhone
2. Digite o endereço do app: **https://financas-nu-ten.vercel.app**
3. Toque no botão **Compartilhar** (quadradinho com seta para cima, embaixo)
4. Role e toque em **Adicionar à Tela de Início** (Add to Home Screen)
5. Toque em **Adicionar** (canto superior direito)
6. Pronto! O ícone do app aparece na tela inicial — abra por ele (abre em tela cheia, sem barra do navegador)
7. Na primeira abertura, vá em **Nuvem → Criar meu espaço** e guarde o código que aparecer

> 💡 O iPhone não instala APK (arquivo Android). A versão PWA é o jeito oficial — e funciona igual.

---

## 3. Instalar no Android (APK — instala como app de verdade)

1. No celular Android, abra o navegador e acesse:
   **https://github.com/ANTHONY20-melo/financas/releases**
2. Toque na release mais recente (ex.: `v1.0.0`) e baixe o arquivo **`.apk`**
3. O Android pode pedir permissão para instalar "apps de fontes desconhecidas" — permita (é o seu próprio app)
4. Abra o arquivo baixado e toque em **Instalar**
5. Pronto! O app aparece com nome **Finanças** na tela inicial
6. Na primeira abertura, vá em **Nuvem → Criar meu espaço** e guarde o código

> 💡 Alternativa sem APK: abrir o mesmo link https://financas-nu-ten.vercel.app no Chrome e tocar em **Adicionar à tela inicial** (menu ⋮) — vira um PWA com atalho na tela.

---

## 4. Instalar no Computador (qualquer sistema)

1. Abra o Chrome/Edge no PC
2. Acesse **https://financas-nu-ten.vercel.app**
3. No Chrome: menu ⋮ → **Instalar página como app…** / No Edge: ⋯ → **Aplicativos → Instalar este site como um app**
4. Pronto — abre em janela própria, funciona offline

---

## 5. Primeiros passos (para o cliente)

1. **Criar o espaço (1 toque):** menu → **Nuvem** → **Criar meu espaço** → anote o código em lugar seguro
2. **Lançar um gasto:** **+ Nova Transação** → descrição, valor, categoria, data → Salvar
3. **Acompanhar:** o **Dashboard** mostra saldo, despesas, receitas e o que está **A Pagar**
4. **Sincronizar entre aparelhos SEUS:** no outro aparelho → **Nuvem → Ativar** → digitar o MESMO código → os dados se juntam

---

## 6. Suporte rápido (o que responder aos clientes)

- **"Perdi meu código"** → sem o código, os dados da nuvem ficam inacessíveis (segurança de verdade). Os dados **deste aparelho** continuam. Crie um novo espaço e continue de onde parou neste aparelho.
- **"Quero começar do zero"** → **Nuvem → Apagar espaço na nuvem** (remove da nuvem; este aparelho continua com os dados).
- **"Cadê meu login?"** → Não existe — é proposital: seu espaço é o seu código.
- **"Não abre no iPhone"** → use o **Safari** (não Chrome) para Adicionar à Tela de Início.

---

## 7. Notas técnicas para você (vendedor)

- **Privacidade:** criptografia AES-256-GCM no aparelho, chave derivada do código (PBKDF2 150k). A nuvem guarda só o texto cifrado.
- **Espaços:** cada código gera um `space_id` (SHA-256) — apagar o código não dá para recuperar os dados (isso é uma feature de segurança, não bug).
- **Offline:** o app funciona sem internet (os dados ficam no aparelho); a nuvem é só para sincronizar/backup.
- **Backup manual:** menu → botão de exportar (ícone de download na barra lateral) gera um arquivo JSON que pode ser importado em qualquer outro aparelho.
