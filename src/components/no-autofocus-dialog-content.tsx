import * as React from "react"
import { DialogContent } from "@/components/ui/dialog"

export type NoAutofocusDialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogContent
>

export const NoAutofocusDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogContent>,
  NoAutofocusDialogContentProps
>(({ onOpenAutoFocus, ...props }, forwardedRef) => {
  const contentRef = React.useRef<React.ElementRef<typeof DialogContent>>(null)
  const setContentRef = React.useCallback(
    (node: React.ElementRef<typeof DialogContent> | null) => {
      contentRef.current = node
      if (typeof forwardedRef === "function") {
        forwardedRef(node)
      } else if (forwardedRef !== null) {
        forwardedRef.current = node
      }
    },
    [forwardedRef],
  )

  return (
    <DialogContent
      {...props}
      ref={setContentRef}
      tabIndex={-1}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        contentRef.current?.focus()
        onOpenAutoFocus?.(event)
      }}
    />
  )
})
NoAutofocusDialogContent.displayName = "NoAutofocusDialogContent"
