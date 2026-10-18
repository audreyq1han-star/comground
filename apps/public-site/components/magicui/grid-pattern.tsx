// Adapted from Magic UI's MIT-licensed GridPattern; see vendor/README.md.
import { useId, type SVGProps } from 'react';

interface GridPatternProps extends SVGProps<SVGSVGElement> {
  width?: number; height?: number; x?: number; y?: number;
  squares?: Array<[number, number]>; strokeDasharray?: string;
}

export function GridPattern({ width = 40, height = 40, x = -1, y = -1, strokeDasharray = '0', squares, className = '', ...props }: GridPatternProps) {
  const id = useId();
  return <svg aria-hidden="true" className={`grid-pattern ${className}`} {...props}>
    <defs><pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}><path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} /></pattern></defs>
    <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
    {squares && <svg x={x} y={y} style={{ overflow: 'visible' }}>{squares.map(([sx, sy]) => <rect key={`${sx}-${sy}`} strokeWidth={0} width={width - 1} height={height - 1} x={sx * width + 1} y={sy * height + 1} />)}</svg>}
  </svg>;
}
