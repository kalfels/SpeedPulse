<p align="center">
  <img src="./assets/logo_sp_header.png" alt="SpeedPulse" width="460">
</p>

# SpeedPulse

Aplicativo móvel para medir a **velocidade e a estabilidade da conexão à internet**. O SpeedPulse acompanha o teste em tempo real e guarda os resultados no aparelho para comparar redes Wi-Fi, dados móveis e locais diferentes.

**React Native 0.88 · React 19 · Expo SDK 58 · TypeScript · npm**

[Como rodar](#como-rodar) · [Como usar](#como-usar) · [Como as medições funcionam](#como-as-medições-funcionam) · [React Native no projeto](#react-native-no-projeto)

## Como rodar

### 1. Instale os pré-requisitos

- [Node.js](https://nodejs.org/) **24 LTS (24.3.0 ou mais recente na linha 24)**, com npm, e [Git](https://git-scm.com/) para clonar o repositório.
- Para rodar no celular: **Expo Go** compatível com o **SDK 58**. Não é necessário instalar Android Studio ou Xcode para usar o Expo Go em um aparelho físico.
- Para rodar no computador: emulador Android configurado no [Android Studio](https://docs.expo.dev/workflow/android-studio-emulator/) ou, no macOS, simulador iOS configurado no [Xcode](https://docs.expo.dev/workflow/ios-simulator/).

### 2. Instale as dependências

```sh
git clone https://github.com/kalfels/SpeedPulse.git
cd SpeedPulse
npm ci
```

Se você já abriu a pasta do projeto no VS Code, execute apenas `npm ci` no terminal da raiz. Esse comando usa as versões registradas no [package-lock.json](./package-lock.json). O projeto não exige arquivo `.env`, chaves de API ou um servidor próprio para rodar.

### 3. Inicie o aplicativo

```sh
npm start
```

O Expo inicia o **Metro**, que prepara e serve o código para o aplicativo. Mantenha esse terminal aberto enquanto usa o SpeedPulse.

| Onde rodar | O que fazer |
| --- | --- |
| **Celular Android** | Deixe o computador e o celular na mesma rede Wi-Fi e escaneie o QR code pelo Expo Go. |
| **iPhone** | Na mesma rede Wi-Fi, escaneie o QR code com a câmera do iPhone e abra no Expo Go. Em aparelho físico, entre na mesma conta Expo no app e no terminal (`npx expo login`). |
| **Emulador Android** | Com o emulador aberto, pressione `a` no terminal do Expo. Para iniciar o Metro e abrir o emulador em um só comando, use `npm run android` no lugar de `npm start`. |
| **Simulador iOS (macOS)** | Com o simulador aberto, pressione `i` no terminal do Expo ou use `npm run ios` no lugar de `npm start`. |

O foco do projeto é o uso no celular. Embora exista um script `npm run web`, o repositório não inclui as dependências para executar no navegador. Para testar o tipo de rede, a localização e o compartilhamento, prefira um aparelho físico.

## Como usar

1. Abra o SpeedPulse e toque em **Iniciar teste**. A permissão de localização é opcional: se ela não for concedida ou a posição não estiver disponível, o app usa a cidade estimada pelo IP quando disponível.
2. Acompanhe **ping**, **jitter**, **download** e **upload**. O velocímetro mostra a taxa medida durante as transferências e os minigráficos mostram como ela variou.
3. Ao final de um teste completo, consulte o **diagnóstico estimado** para usos como streaming, chamadas e jogos online. Se a medição for interrompida, o app indica o erro e mantém os dados que conseguiu coletar.
4. No **Histórico de testes**, confira a média de download, o melhor ping e o número de testes salvos. Combine os filtros de rede e de cidade para comparar resultados. O resumo considera todos os registros salvos, não só os filtrados.
5. Toque em **Compartilhar** em um resultado para abrir o menu do sistema com a data, a cidade, o IP público, o tipo de rede e as métricas. Nada é enviado automaticamente. **Limpar** apaga o histórico do aparelho.

> **Consumo de dados:** um teste completo solicita cerca de **25 MB de download** e envia **5 MiB de upload**, sem contar as pequenas requisições auxiliares. Faça a primeira execução em Wi-Fi se quiser economizar o plano de dados.

## Como as medições funcionam

| Métrica | O que o SpeedPulse mede |
| --- | --- |
| **Ping (ms)** | Média do tempo de resposta de pequenas requisições HTTP à Cloudflare. O app faz oito tentativas e exige pelo menos cinco respostas válidas. É latência HTTP, não um ping ICMP. |
| **Jitter (ms)** | Média das diferenças absolutas entre amostras válidas consecutivas de latência. Por exemplo, amostras de `20 → 30 → 25 ms` têm diferenças de `10` e `5 ms`, resultando em `7,5 ms` de jitter. |
| **Download e upload (Mbps)** | Volume recebido ou enviado dividido pelo tempo da transferência. O arco usa escala logarítmica até 1.000 Mbps; cada minigráfico tem sua própria escala. Testes muito rápidos podem aparecer com um único ponto. |
| **Tipo de rede** | Interface identificada no início da medição. Na rede móvel, aparece a geração (como 4G ou 5G) quando o sistema fornece essa informação. |

O diagnóstico combina ping, jitter e download. O resultado descreve a conexão com o servidor de teste naquele momento, não garante o desempenho de todos os sites, serviços ou jogos. Distância ao servidor, congestionamento e atividade de outros aparelhos podem mudar os números.

**Dados e serviços externos.** As transferências de teste usam a Cloudflare. Consultas de IP público e geolocalização aproximada podem usar `ipwho.is` e `ipapi.co`; a localização do aparelho só é solicitada quando o teste começa. Até 20 resultados ficam no armazenamento local, sem sincronização própria na nuvem. Revise a cidade e o IP público antes de compartilhar um resultado.

## React Native no projeto

**React** define a interface por meio de componentes e estados. **React Native** usa esse mesmo modelo para renderizar interfaces nativas no Android e no iOS: em vez de `div`, `p` e CSS do navegador, o SpeedPulse usa `View`, `Text`, `Image` e estilos com `StyleSheet`. O layout usa Flexbox, e a mesma tela é mantida em TypeScript para as duas plataformas.

**Expo** complementa o React Native com ferramentas: o Expo CLI inicia o Metro, o Expo Go abre o app no dispositivo e o `expo-location` oferece acesso à localização. O Expo não substitui o React Native: a interface, as animações e chamadas como `Share.share()` continuam usando APIs do React Native.

| No SpeedPulse | Exemplo de uso |
| --- | --- |
| **Estado e efeitos do React** | `useState` guarda a fase do teste, as métricas e os filtros. Ao chegar um novo resultado, o React atualiza o velocímetro e os cartões. `useEffect` carrega o histórico e gerencia animações. |
| **Componentes e APIs móveis** | `FlatList` exibe o histórico sem tirar o cabeçalho fixo do topo; `Animated` dá movimento à interface; `Share.share()` abre o menu nativo. |
| **Bibliotecas integradas** | NetInfo identifica a conexão; `react-native-svg` desenha o arco e as curvas; AsyncStorage mantém os resultados entre sessões. |

### Onde encontrar o código

| Caminho | Responsabilidade |
| --- | --- |
| [index.ts](./index.ts) | Registra o componente principal no Expo. |
| [App.tsx](./App.tsx) | Tela principal, fases do teste, integração com o aparelho, histórico e compartilhamento. |
| [SpeedCharts.tsx](./SpeedCharts.tsx) | Velocímetro animado e minigráficos de download e upload. |
| [speedMetrics.ts](./speedMetrics.ts) | Cálculos, diagnóstico, filtros e formatação dos resultados. |
| [speedMetrics.test.cjs](./speedMetrics.test.cjs) | Testes unitários da lógica de medição e do histórico. |
| [app.json](./app.json) | Nome, ícones, orientação e configuração do app no Expo. |

## Comandos de desenvolvimento

```sh
npm run lint
npx tsc --noEmit
node --test speedMetrics.test.cjs
```

Para adicionar uma dependência compatível com o SDK do projeto, use `npx expo install nome-do-pacote`. Para verificar as versões instaladas, use `npx expo install --check`.

### Se algo não funcionar

- **O QR code não abre no celular:** confirme que os aparelhos estão na mesma rede e que o firewall não está bloqueando a conexão. Se a rede local bloquear a comunicação, pare o Metro e tente `npx expo start --tunnel`.
- **O Expo Go informa SDK incompatível:** confira se a versão do Expo Go é compatível com o SDK 58. Consulte o [guia de configuração do Expo](https://docs.expo.dev/get-started/set-up-your-environment/) para a plataforma usada.
- **O emulador não abre:** inicie o aparelho virtual pelo Android Studio ou pelo Xcode antes de abrir o app pelo Expo.
- **O teste falha ou a cidade não aparece:** confira o acesso à internet e as permissões de localização. Redes restritas podem bloquear o servidor de teste; nesse caso, tente outra rede. A cidade pelo IP é aproximada e pode diferir da localização real.

## Licença

Distribuído sob a [licença MIT](./LICENSE).
