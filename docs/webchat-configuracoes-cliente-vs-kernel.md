# Configurações de Webchat: Cliente vs. Kernel

> Separação entre parâmetros configuráveis pelo cliente (via painel/API) e configurações de kernel (nível de sistema, definidas pela plataforma)

**Critério de separação:**
- **Cliente**: afeta a experiência do widget/atendimento daquela empresa; seguro expor em UI ou API pública; não compromete outros tenants nem a infraestrutura.
- **Kernel**: afeta segurança, integridade multi-tenant, performance da plataforma ou infraestrutura compartilhada; definido pelo provedor (Tuuvo), não pelo cliente final.

---

## 1. Aparência Visual

| Cliente | Kernel |
|---|---|
| Cores, logo, avatar | Renderização/engine do widget (SVG vs canvas etc.) |
| Formato do launcher, posição na tela | Limite de tamanho de asset (logo, ícone) |
| Tema (claro/escuro/auto) | CSP (Content Security Policy) do embed |
| Fonte, border radius | Sandbox de isolamento do iframe |
| Animações | — |

## 2. Comportamento de Abertura

| Cliente | Kernel |
|---|---|
| Abertura automática, delay, gatilhos | Limite mínimo/máximo de delay permitido (anti-abuso) |
| Persistência de estado por sessão | Mecanismo de persistência (cookie/localStorage/token) |

## 3. Mensagens e Conteúdo

| Cliente | Kernel |
|---|---|
| Texto das mensagens (boas-vindas, ausência, despedida) | Limite de caracteres por mensagem |
| Quick replies, botões de CTA | Sanitização/validação de input (XSS, injection) |
| Campos do formulário pré/pós-chat | Tipos de arquivo permitidos globalmente, antivírus/scan de anexos |
| — | Tamanho máximo absoluto de anexo (definido na infraestrutura) |

## 4. Horário e Disponibilidade

| Cliente | Kernel |
|---|---|
| Horário de atendimento, fuso horário, feriados | Cálculo/engine de disponibilidade (cron, timezone lib) |
| Mensagem fora do horário | — |

## 5. Roteamento e Atribuição

| Cliente | Kernel |
|---|---|
| Departamentos, skills, idiomas de roteamento | Algoritmo de distribuição (round-robin, load-based) |
| Regras de escalonamento bot→humano | Motor de fila e balanceamento entre tenants |
| — | Limites de concorrência por operador (proteção de sistema) |

## 6. Identidade e Autenticação

| Cliente | Kernel |
|---|---|
| Exigir ou não CPF/e-mail em etapas | Modelo de identidade progressiva (Interlocutor → Contato → Cliente Verificado) |
| Campos customizados de captura | Geração e validação de JWT/SSO |
| — | Hashing/criptografia de dados sensíveis, política de sessão |

## 7. Bots e IA

| Cliente | Kernel |
|---|---|
| Base de conhecimento, tom/personalidade do bot | Modelo de IA usado, versão, infraestrutura de inferência |
| Confiança mínima para transferir a humano (se exposto como slider) | Rate limiting de chamadas à IA, custo/quota por tenant |

## 8. Notificações

| Cliente | Kernel |
|---|---|
| Ativar/desativar som, badge, e-mail de transcrição | Infraestrutura de envio (SMTP, push service, webhooks engine) |
| URL de webhook customizado | Assinatura/validação de payload (segurança do webhook) |

## 9. Multicanal e Integrações

| Cliente | Kernel |
|---|---|
| Quais canais ativar (WhatsApp, Instagram, e-mail) | Conexão BSP/Meta, gestão de tokens de API dos canais |
| Configuração de CRM/calendário do cliente | Camada de abstração de provedor (ex: Zernio e outros, trocáveis) |

## 10. Segmentação e Personalização

| Cliente | Kernel |
|---|---|
| Regras por página/URL, UTM, segmento de cliente | Motor de regras/segmentação (engine que interpreta as regras) |

## 11. Privacidade e Compliance (LGPD)

| Cliente | Kernel |
|---|---|
| Texto do aviso de consentimento | Retenção de dados (política técnica de storage) |
| — | Criptografia em trânsito/repouso |
| — | Anonimização de logs, exclusão/exportação de dados (mecanismo) |
| — | Auditoria e trilha de acesso a dados sensíveis |

## 12. Performance e Técnico

| Cliente | Kernel |
|---|---|
| — (não configurável pelo cliente) | Lazy load, domínios permitidos (whitelist de embed) |
| — | Rate limiting geral, tamanho de histórico carregado, offline queue |

## 13. Acessibilidade

| Cliente | Kernel |
|---|---|
| Ativar/desativar modo de alto contraste (se oferecido como opção) | Implementação ARIA, navegação por teclado (parte do core do widget) |

## 14. Analytics e Relatórios

| Cliente | Kernel |
|---|---|
| Quais métricas exibir no dashboard, exportação de relatórios | Coleta e agregação de eventos, pipeline de analytics |
| Integração com GA/GTM (ativar e inserir ID) | Infraestrutura de tracking interna |

---

## Resumo do princípio

- **Configuração de Cliente** = personalização de experiência e negócio, exposta via painel/API, isolada por tenant.
- **Configuração de Kernel** = regras de segurança, infraestrutura compartilhada, integridade de dados e comportamento core do sistema — não deve ser exposta nem alterável por tenant individual, sob risco de comprometer outros clientes ou a plataforma como um todo.
