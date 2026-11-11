// Descoberta na rede local: o ESP32 manda "TERMOPOLIV?" em broadcast UDP e o
// servidor responde "TERMOPOLIV <porta-http>". O ESP32 tira o IP do remetente
// da resposta, então ninguém precisa digitar o IP do computador no código.
import dgram from 'node:dgram';

export const PORTA_DESCOBERTA = 8099;
const PERGUNTA = 'TERMOPOLIV?';

export function iniciarDescoberta({ portaHttp, porta = PORTA_DESCOBERTA, endereco = '0.0.0.0' }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('message', (mensagem, remetente) => {
    if (mensagem.toString('utf8').trim() !== PERGUNTA) return;
    socket.send(`TERMOPOLIV ${portaHttp}`, remetente.port, remetente.address);
  });
  socket.on('error', (erro) => {
    console.warn(`Descoberta automática desligada (${erro.code ?? erro.message}). `
      + 'O ESP32 vai precisar do IP deste computador em URL_SERVIDOR.');
    socket.close();
  });
  const pronto = new Promise((resolve) => socket.bind(porta, endereco, resolve));
  return { socket, pronto };
}
