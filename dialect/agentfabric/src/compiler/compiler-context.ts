/**
 * Compiler diagnostic context — threads diagnostics through compilation.
 */

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface CompilerDiagnostic {
  message: string;
  severity: DiagnosticSeverity;
}

export class AgentFabricCompilerContext {
  readonly diagnostics: CompilerDiagnostic[] = [];

  error(message: string): void {
    this.diagnostics.push({ message, severity: DiagnosticSeverity.Error });
  }

  warn(message: string): void {
    this.diagnostics.push({ message, severity: DiagnosticSeverity.Warning });
  }
}
