/**
 * Mapa central de driver de canal. Adicionar um canal novo = escrever o
 * arquivo do driver + adicionar 1 linha aqui — nenhum outro arquivo do
 * projeto precisa saber que o canal existe (arquitetura v2, seção 3.1).
 */
import { ChannelDriver } from "./ChannelDriver";
import { whatsAppGtiDriver } from "./WhatsAppGtiDriver";
import { zernioDriver } from "./ZernioDriver";
import { rcsMkomDriver } from "./MkomRcsDriver";
import { emailDriver } from "./EmailDriver";

const drivers: Record<string, ChannelDriver> = {
  [whatsAppGtiDriver.name]: whatsAppGtiDriver,
  [zernioDriver.name]: zernioDriver, // cobre whatsapp_zernio + redes sociais, ver seção 3.3
  [rcsMkomDriver.name]: rcsMkomDriver,
  [emailDriver.name]: emailDriver,
  // webchat_native não passa por aqui — tratado direto pelo realtime/socket.ts,
  // não existe "provedor externo" nesse canal.
};

export function getDriver(driverName: string): ChannelDriver {
  const driver = drivers[driverName];
  if (!driver) {
    throw new Error(`Driver de canal desconhecido: ${driverName}`);
  }
  return driver;
}
