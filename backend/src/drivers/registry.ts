import { ChannelDriver } from "./ChannelDriver";
import { whatsAppGtiDriver } from "./WhatsAppGtiDriver";
import { smsMkomDriver, rcsMkomDriver } from "./SmsRcsMkomDriver";
import { zernioDriver } from "./ZernioDriver";

const drivers: Record<string, ChannelDriver> = {
  [whatsAppGtiDriver.name]: whatsAppGtiDriver,
  [smsMkomDriver.name]: smsMkomDriver,
  [rcsMkomDriver.name]: rcsMkomDriver,
  [zernioDriver.name]: zernioDriver,
  // webchat_native não passa por aqui — é tratado direto pelo realtime/socket.ts,
  // já que não existe "provedor externo" nesse canal.
};

export function getDriver(driverName: string): ChannelDriver {
  const driver = drivers[driverName];
  if (!driver) {
    throw new Error(`Driver de canal desconhecido: ${driverName}`);
  }
  return driver;
}
