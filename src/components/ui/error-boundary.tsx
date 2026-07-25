/**
 * error-boundary.tsx — Componente de Error Boundary para módulos críticos
 *
 * Uso:
 *   <AppErrorBoundary module="Financeiro">
 *     <FinanceiroPage />
 *   </AppErrorBoundary>
 */

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: React.ReactNode;
  /** Nome do módulo para exibição no fallback */
  module?: string;
  /** Fallback customizado opcional */
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    // ✅ Log estruturado para monitoramento — sem expor dados sensíveis do cliente
    console.error("[AppErrorBoundary]", {
      module: this.props.module ?? "unknown",
      message: error.message,
      // Não logamos errorInfo.componentStack em produção (pode conter dados sensíveis)
      stack: import.meta.env.DEV ? error.stack : undefined,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const moduleName = this.props.module ?? "módulo";
      const isDev = import.meta.env.DEV;

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center gap-4">
          <div className="grid place-items-center size-14 rounded-2xl bg-rose-500/10 mb-2">
            <AlertTriangle className="size-7 text-rose-400" />
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Erro no módulo de {moduleName}
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Ocorreu um problema inesperado. Seus dados estão seguros.
              Clique em "Tentar novamente" para recarregar este módulo.
            </p>
          </div>

          {isDev && this.state.error && (
            <pre className="mt-2 max-w-lg overflow-auto rounded-lg bg-muted/60 p-3 text-left text-[11px] text-destructive border border-destructive/20">
              {this.state.error.message}
            </pre>
          )}

          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={this.handleReset} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              Tentar novamente
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
              Recarregar página
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Wrapper funcional para uso em Suspense + Error Boundary combinados
 *
 * Exemplo:
 *   <SuspenseErrorBoundary module="Processos" fallback={<ProcessosSkeleton />}>
 *     <ProcessosContent />
 *   </SuspenseErrorBoundary>
 */
export function SuspenseErrorBoundary({
  children,
  module: moduleName,
  fallback,
}: {
  children: React.ReactNode;
  module?: string;
  fallback?: React.ReactNode;
}) {
  return (
    <AppErrorBoundary module={moduleName}>
      <React.Suspense fallback={fallback ?? <DefaultSkeleton />}>
        {children}
      </React.Suspense>
    </AppErrorBoundary>
  );
}

function DefaultSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-6 animate-pulse">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-muted/40" />
      ))}
    </div>
  );
}
