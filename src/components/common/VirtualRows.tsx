/**
 * Virtualized fixed-height row list (react-window v2 List) for long boards.
 */
import { List } from 'react-window';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type VirtualRowRender<T> = (args: {
  index: number;
  style: CSSProperties;
  item: T;
}) => ReactNode;

export function VirtualRows<T>({
  items,
  rowHeight = 28,
  height = 320,
  className,
  renderRow,
  overscanCount = 6,
}: {
  items: T[];
  rowHeight?: number;
  /** Pixel height, or CSS size (e.g. '100%') when parent is sized. */
  height?: number | string;
  className?: string;
  renderRow: VirtualRowRender<T>;
  overscanCount?: number;
}) {
  if (!items.length) return null;

  // react-window v2 List API matches OptionChain usage
  const RowComponent = ({
    index,
    style,
    data,
  }: {
    index: number;
    style: CSSProperties;
    data: T[];
  }) => {
    const item = data[index];
    if (item === undefined) return null;
    return <div role="listitem" style={style}>{renderRow({ index, style: {}, item })}</div>;
  };

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <List
        rowComponent={RowComponent as never}
        rowCount={items.length}
        rowHeight={rowHeight}
        rowProps={{ data: items } as never}
        overscanCount={overscanCount}
        tabIndex={0}
        aria-label="Scrollable rows"
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}
