'use client';

import { AlertCircle, Loader2, Sparkles, UserCheck } from 'lucide-react';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useImageModels, formatModelPrice, type ImageModel } from '@/hooks/use-image-models';

/**
 * Picks the Mesh image model.
 *
 * Capability and price come from Mesh's live catalog, never from a hardcoded
 * table — so a model is offered as identity-preserving only when Mesh reports
 * `supports_image_reference`. When the render needs a reference (the creator's
 * face), incompatible models are disabled rather than hidden, so the user can
 * see *why* their favourite model isn't selectable.
 */
export function ModelPicker({
  value,
  onChange,
  needsReference,
  dark,
  className,
}: {
  value?: string;
  onChange: (id: string) => void;
  /** True when a face/reference image will be sent (i.e. "feature me" is on). */
  needsReference: boolean;
  dark?: boolean;
  className?: string;
}) {
  const { models, loading, error } = useImageModels();

  if (loading) {
    return (
      <div className={cn('flex h-10 items-center gap-2 rounded-md border px-3 text-xs',
        dark ? 'border-white/10 bg-white/5 text-slate-400' : 'border-input text-muted-foreground', className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models from Mesh…
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex h-10 items-center gap-2 rounded-md border border-destructive/40 px-3 text-xs text-destructive', className)}>
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{error}</span>
      </div>
    );
  }

  const reference = models.filter((m) => m.supportsReference);
  const textOnly = models.filter((m) => !m.supportsReference);
  const recommended = models.filter((m) => m.recommended && (!needsReference || m.supportsReference));

  const selected = models.find((m) => m.id === value);
  // A stale/incompatible selection must not silently render a stranger's face.
  const invalid = Boolean(selected && needsReference && !selected.supportsReference);

  return (
    <div className={cn('space-y-1.5', className)}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={cn(dark && 'bg-white/5 border-white/10 text-white', invalid && 'border-destructive')}>
          {/* No selection is a valid state: the server falls back to its proven
              defaults. Say so, rather than implying the field is required. */}
          <SelectValue placeholder="Automatic — use the proven default" />
        </SelectTrigger>
        <SelectContent className="max-h-[380px]">
          {recommended.length > 0 && (
            <SelectGroup>
              <SelectLabel className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" /> Recommended
              </SelectLabel>
              {recommended.map((m) => <Row key={`rec-${m.id}`} model={m} disabled={false} />)}
            </SelectGroup>
          )}

          <SelectGroup>
            <SelectLabel className="flex items-center gap-1.5">
              <UserCheck className="h-3 w-3" /> Keeps your face ({reference.length})
            </SelectLabel>
            {reference.map((m) => <Row key={m.id} model={m} disabled={false} />)}
          </SelectGroup>

          <SelectGroup>
            <SelectLabel>Text-to-image only ({textOnly.length})</SelectLabel>
            {textOnly.map((m) => (
              // Disabled — not hidden — when a reference render is in flight, so
              // the reason is visible instead of the model just vanishing.
              <Row key={m.id} model={m} disabled={needsReference} />
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {invalid ? (
        <p className="flex items-center gap-1.5 text-micro text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {selected!.name} can’t take reference images — it won’t reproduce your face.
        </p>
      ) : selected ? (
        <p className={cn('text-micro', dark ? 'text-slate-500' : 'text-muted-foreground')}>
          {formatModelPrice(selected)}
          {selected.supportsReference && ' · preserves your face from reference images'}
        </p>
      ) : (
        <p className={cn('text-micro', dark ? 'text-slate-500' : 'text-muted-foreground')}>
          {needsReference
            ? 'Defaults to Gemini 2.5 Flash Image, which preserves your face from references.'
            : 'Defaults to GPT Image 1. Pick a model to trade cost against quality.'}
        </p>
      )}
    </div>
  );
}

function Row({ model, disabled }: { model: ImageModel; disabled: boolean }) {
  return (
    <SelectItem value={model.id} disabled={disabled}>
      <span className="flex w-full items-center justify-between gap-3">
        <span className="truncate">{model.name}</span>
        {/* Inherit the row's colour and dim it, rather than pinning
            `text-muted-foreground` — the highlighted row's background is the
            saturated accent, on which a grey price is unreadable. */}
        <span className="shrink-0 text-micro opacity-60 tabular">
          {disabled ? 'no face support' : formatModelPrice(model)}
        </span>
      </span>
    </SelectItem>
  );
}
