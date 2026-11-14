"use client"

import * as React from "react"
import { CircleAlert } from "lucide-react"
import {
  Controller,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type FormState,
} from "react-hook-form"

import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"

/**
 * Props every bound control spreads. `FormField` owns them so no form
 * hand-wires label ↔ control ↔ error again.
 */
export interface FormControlProps {
  id: string
  "aria-invalid": true | undefined
  "aria-describedby": string | undefined
  "aria-required": true | undefined
}

export interface FormFieldRenderArgs<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
> {
  /**
   * RHF's field binding without `ref` — `FormField` registers its own focus
   * target by id, so widgets that don't forward a ref (RupiahInput,
   * DatePicker, Select) still receive focus on a failed submit.
   * Spread it on `Input`/`Textarea`; map `value`/`onChange` for the rest.
   */
  field: Omit<ControllerRenderProps<TValues, TName>, "ref">
  fieldState: ControllerFieldState
  controlProps: FormControlProps
}

export interface FormFieldProps<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
  TTransformed extends FieldValues = TValues,
> {
  control: Control<TValues, unknown, TTransformed>
  name: TName
  label?: React.ReactNode
  description?: React.ReactNode
  /** Adds the asterisk and `aria-required`. Validation itself comes from the schema. */
  required?: boolean
  /** `horizontal` puts the control before the label — checkboxes and switches. */
  orientation?: "vertical" | "horizontal"
  /** Override the generated control id (keeps an existing e2e/`htmlFor` id stable). */
  id?: string
  className?: string
  render: (args: FormFieldRenderArgs<TValues, TName>) => React.ReactElement
}

/**
 * One labelled, validated form control, bound to react-hook-form through
 * `Controller` and laid out with the shadcn `Field` primitives.
 *
 * ```tsx
 * <FormField control={form.control} name="name" label="Nama" required
 *   render={({ field, controlProps }) => <Input {...field} {...controlProps} />} />
 *
 * <FormField control={form.control} name="type" label="Tipe"
 *   render={({ field, controlProps }) => (
 *     <Select value={field.value} onValueChange={field.onChange}>
 *       <SelectTrigger {...controlProps} onBlur={field.onBlur}>…</SelectTrigger>
 *     </Select>
 *   )} />
 * ```
 */
export function FormField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
  TTransformed extends FieldValues = TValues,
>({
  control,
  name,
  label,
  description,
  required,
  orientation = "vertical",
  id: idProp,
  className,
  render,
}: FormFieldProps<TValues, TName, TTransformed>) {
  const generatedId = React.useId()
  const id = idProp ?? `field-${generatedId}`

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormFieldLayout
          id={id}
          label={label}
          description={description}
          required={required}
          orientation={orientation}
          className={className}
          field={field}
          fieldState={fieldState}
          render={render}
        />
      )}
    />
  )
}

const TABBABLE =
  'input, select, textarea, button, [tabindex], [contenteditable="true"]'

function isTabbable(el: HTMLElement): boolean {
  return (
    el.tabIndex >= 0 &&
    !el.hasAttribute("disabled") &&
    el.getAttribute("aria-hidden") !== "true"
  )
}

function FormFieldLayout<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  id,
  label,
  description,
  required,
  orientation,
  className,
  field,
  fieldState,
  render,
}: {
  id: string
  label?: React.ReactNode
  description?: React.ReactNode
  required?: boolean
  orientation: "vertical" | "horizontal"
  className?: string
  field: ControllerRenderProps<TValues, TName>
  fieldState: ControllerFieldState
  render: FormFieldProps<TValues, TName>["render"]
}) {
  const { ref: registerRef, ...binding } = field
  const fieldRef = React.useRef<HTMLDivElement>(null)
  // Point RHF's focus-on-error at the control itself instead of requiring
  // every widget to forward a ref. `id` usually lands on the focusable
  // element (native input, Select/DatePicker trigger); base-ui Checkbox and
  // Switch put it on a hidden, `aria-hidden` shadow input instead, so fall
  // back to the first tabbable element inside this field.
  React.useLayoutEffect(() => {
    registerRef({
      focus: () => {
        const byId = document.getElementById(id)
        if (byId && isTabbable(byId)) return byId.focus()
        const fallback = Array.from(
          fieldRef.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? []
        ).find(isTabbable)
        fallback?.focus()
      },
    })
  }, [registerRef, id])

  const invalid = fieldState.invalid
  // Focus alone only reveals the control. In a docked-footer dialog the
  // explanation can remain below the scroll viewport, so reveal the whole
  // field once the error message has committed to the DOM.
  React.useEffect(() => {
    const fieldElement = fieldRef.current
    if (!invalid || !fieldElement?.contains(document.activeElement)) return
    const frame = requestAnimationFrame(() => {
      if (!fieldElement.contains(document.activeElement)) return
      fieldElement.scrollIntoView?.({ block: "nearest", inline: "nearest" })
    })
    return () => cancelAnimationFrame(frame)
  }, [invalid, fieldState.error?.message])
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = invalid ? `${id}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined

  const control = render({
    field: binding,
    fieldState,
    controlProps: {
      id,
      "aria-invalid": invalid || undefined,
      "aria-describedby": describedBy,
      "aria-required": required || undefined,
    },
  })

  const labelNode = label ? (
    <FieldLabel htmlFor={id} required={required}>
      {label}
    </FieldLabel>
  ) : null
  const descriptionNode = description ? (
    <FieldDescription id={descriptionId}>{description}</FieldDescription>
  ) : null
  const errorNode = <FieldError id={errorId} errors={[fieldState.error]} />

  if (orientation === "horizontal") {
    return (
      <Field
        ref={fieldRef}
        orientation="horizontal"
        data-invalid={invalid || undefined}
        className={className}
      >
        {control}
        <FieldContent>
          {labelNode}
          {descriptionNode}
          {errorNode}
        </FieldContent>
      </Field>
    )
  }

  return (
    <Field ref={fieldRef} data-invalid={invalid || undefined} className={className}>
      {labelNode}
      {control}
      {descriptionNode}
      {errorNode}
    </Field>
  )
}

/**
 * The server-side failure that isn't about one field (a 409, a 500, a
 * network error), set by `applyServerErrors` as `errors.root.server`.
 * Place it at the top of the form body.
 */
export function FormRootError({
  formState,
  className,
}: {
  formState: Pick<FormState<FieldValues>, "errors">
  className?: string
}) {
  const message = formState.errors.root?.server?.message
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert" className={className}>
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

/**
 * Batal + submit for a `ResponsiveFormDialog` whose body is
 * `<form id={formId} onSubmit={form.handleSubmit(onSubmit)} noValidate>`.
 * Labels follow `ui.md`: `Tambah <Entity>` to create, `Simpan Perubahan`
 * to edit, `Menyimpan...` while pending.
 */
export function FormDialogFooter({
  formId,
  submitLabel,
  pending,
  onCancel,
  cancelLabel = "Batal",
  pendingLabel = "Menyimpan...",
  disabled,
  submitVariant,
  submitTestId,
  className,
}: {
  formId: string
  submitLabel: React.ReactNode
  pending: boolean
  onCancel: () => void
  cancelLabel?: React.ReactNode
  pendingLabel?: React.ReactNode
  disabled?: boolean
  submitVariant?: React.ComponentProps<typeof Button>["variant"]
  submitTestId?: string
  className?: string
}) {
  return (
    <div className={cn("contents", className)}>
      {/* Disabled while pending: cancelling mid-request and reopening would
          let the first request's completion close the reopened dialog. */}
      <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button
        type="submit"
        form={formId}
        variant={submitVariant}
        disabled={pending || disabled}
        aria-busy={pending || undefined}
        data-testid={submitTestId}
      >
        {pending ? pendingLabel : submitLabel}
      </Button>
    </div>
  )
}
