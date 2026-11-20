# Retomada após interrupção do ambiente

As 18 execuções originais foram preservadas sem substituição em `execucoes.json`. Os eventos Kernel-Power 506/507 confirmam espera moderna entre 21:12:49Z e 22:54:33Z, com uma transição intermediária às 21:49:04Z. Os dois placares da rodada inversa atravessaram essa interrupção: seus tempos e limites não servem como comparação de desempenho.

Após o Nícolas dizer “pode seguir”, repetir somente o par interrompido, na mesma ordem B–A, com os mesmos commits, scripts, modelos, ambiente e limite nominal de 45 min. Novos rótulos: `124-placar-5-pr-retomada` e `124-placar-6-base-retomada`. Registrar em `retomada.json`, com novos logs e artefatos, conservando os originais.

A retomada não apaga a falha de enum no primeiro placar B nem substitui seus resultados ruins. É uma tentativa adicional motivada pela suspensão documentada. O novo executor verifica intervalos de mais de 30 s no próprio monitor: se o ambiente voltar a suspender ou bloquear o processo, encerra a execução e para a sequência, sem iniciar a versão seguinte durante a interrupção.

Nenhuma configuração de energia ou fechamento da tampa será alterada. A transcrição continua sem corpus conhecido; “pode seguir” não informa um caminho de áudio nem muda esse requisito. Nada será enviado ao remoto.
