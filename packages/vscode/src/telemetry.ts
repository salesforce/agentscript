import type { ExtensionContext } from 'vscode';

export interface TelemetryService {
  initializeService(context: ExtensionContext): Promise<void>;
  sendExtensionActivationEvent(hrstart: [number, number]): void;
  sendExtensionDeactivationEvent(): void;
  sendException(name: string, message: string): void;
  sendCommandEvent(
    commandName: string,
    duration?: number,
    properties?: Record<string, string>
  ): void;
  sendEventData(
    eventName: string,
    properties?: Record<string, string>,
    measures?: Record<string, number>
  ): void;
}

let telemetryService: TelemetryService | undefined;

export const setTelemetryService = (service: TelemetryService): void => {
  telemetryService = service;
};

export const getTelemetryService = (): TelemetryService | undefined => {
  return telemetryService;
};
