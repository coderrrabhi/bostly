import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { Check, X, AlertTriangle, Info, Loader2 } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-right"
      expand={false}
      richColors={false}
      closeButton
      duration={4000}
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card/85 group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:border-white/60 group-[.toaster]:ring-1 group-[.toaster]:ring-black/[0.04] group-[.toaster]:shadow-[0_2px_6px_-2px_rgba(16,24,40,0.10),0_24px_48px_-20px_rgba(16,24,40,0.28)] group-[.toaster]:rounded-2xl group-[.toaster]:pl-5 group-[.toaster]:pr-5 group-[.toaster]:py-3.5 group-[.toaster]:min-w-[268px] group-[.toaster]:max-w-[380px] group-[.toaster]:gap-3.5 group-[.toaster]:items-center",
          title:
            "group-[.toast]:text-[13px] group-[.toast]:font-bold group-[.toast]:leading-snug group-[.toast]:tracking-[-0.01em] group-[.toast]:text-foreground group-[.toast]:break-words",
          description:
            "group-[.toast]:text-[12px] group-[.toast]:text-muted-foreground group-[.toast]:mt-0.5 group-[.toast]:leading-relaxed group-[.toast]:break-words",
          actionButton:
            "group-[.toast]:bg-foreground group-[.toast]:text-background group-[.toast]:rounded-full group-[.toast]:font-semibold group-[.toast]:text-[11px] group-[.toast]:px-3.5 group-[.toast]:py-1.5 group-[.toast]:transition-all hover:group-[.toast]:opacity-90",
          cancelButton:
            "group-[.toast]:bg-secondary group-[.toast]:text-muted-foreground group-[.toast]:rounded-full group-[.toast]:text-[11px] group-[.toast]:px-3.5 group-[.toast]:py-1.5 group-[.toast]:transition-all hover:group-[.toast]:bg-muted",
          closeButton:
            "!left-auto !right-2.5 !top-2.5 !bg-card/80 !border !border-border/70 !text-muted-foreground hover:!text-foreground hover:!bg-muted !rounded-full !w-5 !h-5 !shadow-sm transition-all",
        },
      }}
      icons={{
        success: (
          <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_6px_14px_-6px_rgba(5,150,105,0.8)] flex items-center justify-center">
            <Check className="h-4 w-4 text-white stroke-[3.5]" />
          </div>
        ),
        error: (
          <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-rose-400 to-rose-600 shadow-[0_6px_14px_-6px_rgba(225,29,72,0.8)] flex items-center justify-center">
            <X className="h-4 w-4 text-white stroke-[3.5]" />
          </div>
        ),
        warning: (
          <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 shadow-[0_6px_14px_-6px_rgba(217,119,6,0.8)] flex items-center justify-center">
            <AlertTriangle className="h-4 w-4 text-white stroke-[3]" />
          </div>
        ),
        info: (
          <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 shadow-[0_6px_14px_-6px_hsl(var(--primary)/0.85)] flex items-center justify-center">
            <Info className="h-4 w-4 text-white stroke-[3]" />
          </div>
        ),
        loading: (
          <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-slate-200 to-slate-400 flex items-center justify-center">
            <Loader2 className="h-4 w-4 text-white animate-spin stroke-[3]" />
          </div>
        ),
      }}

      {...props}
    />
  );
};

export { Toaster, toast };
