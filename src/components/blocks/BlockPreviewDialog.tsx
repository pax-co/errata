import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Spinner, EmptyState } from '@/components/ui/async-view'
import { BlockContentView } from './BlockContentView'

interface BlockPreviewDialogProps {
  storyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BlockPreviewDialog({ storyId, open, onOpenChange }: BlockPreviewDialogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['block-preview', storyId],
    queryFn: () => api.blocks.preview(storyId),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[80vh] flex flex-col p-0 gap-0" data-component-id="block-preview-dialog">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="font-display text-lg flex items-center gap-2.5">
            Context Preview
            {data && (
              <Badge variant="outline" className="text-[0.625rem] font-normal text-muted-foreground">
                {data.blockCount} {data.blockCount === 1 ? 'block' : 'blocks'}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner label="Compiling context" />
          </div>
        ) : data?.messages.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <EmptyState title="No messages in context" />
          </div>
        ) : data ? (
          <BlockContentView
            messages={data.messages}
            blocks={data.blocks}
            className="border-t border-border/30"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
