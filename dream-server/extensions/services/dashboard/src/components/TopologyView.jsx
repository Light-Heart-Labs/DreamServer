import { memo } from 'react'
import { Network } from 'lucide-react'

// Rank → visual style mapping
// NVLink ≥ 100 (fastest), PCIe diminishes from there
function linkStyle(rank) {
  if (rank >= 100) return { dot: 'bg-green-400', badge: 'bg-green-500/15 text-green-400', bar: 'bg-green-500' }
  if (rank >= 60)  return { dot: 'bg-indigo-400', badge: 'bg-indigo-500/15 text-indigo-400', bar: 'bg-indigo-500' }
  if (rank >= 40)  return { dot: 'bg-yellow-400', badge: 'bg-yellow-500/15 text-yellow-400', bar: 'bg-yellow-500' }
  if (rank >= 20)  return { dot: 'bg-orange-400', badge: 'bg-orange-500/15 text-orange-400', bar: 'bg-orange-500' }
  return           { dot: 'bg-red-400',    badge: 'bg-red-500/15 text-red-400',    bar: 'bg-red-500' }
}

export const TopologyView = memo(function TopologyView({ topology }) {
  if (!topology) return null

  const { gpus = [], links = [], vendor, driver_version, mig_enabled } = topology
  const maxRank = Math.max(...links.map(l => l.rank || 0), 1)

  return (
    <div className="p-5 bg-zinc-900/50 border border-zinc-800 rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">GPU Interconnect Topology</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500">
          {driver_version && <span>driver {driver_version}</span>}
          {mig_enabled && (
            <span className="px-1.5 py-0.5 bg-purple-500/15 text-purple-400 rounded">MIG</span>
          )}
          <span className="uppercase">{vendor}</span>
        </div>
      </div>

      {/* GPU index reference */}
      <div className="flex flex-wrap gap-2 mb-4">
        {gpus.map(g => (
          <div key={g.index} className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800 rounded-lg text-xs">
            <span className="text-indigo-300 font-mono">GPU{g.index}</span>
            <span className="text-zinc-400">{g.name.replace('NVIDIA ', '').replace('AMD Radeon ', '')}</span>
            <span className="text-zinc-600 font-mono">{g.memory_gb}GB</span>
          </div>
        ))}
      </div>

      {/* Link table */}
      {links.length > 0 ? (
        <div className="space-y-2">
          {links.map((link, i) => {
            const style = linkStyle(link.rank || 0)
            const barWidth = Math.round((link.rank / maxRank) * 100)
            return (
              <div key={i} className="flex items-center gap-3">
                {/* GPU pair */}
                <div className="flex items-center gap-1.5 w-24 shrink-0">
                  <span className="text-xs font-mono text-zinc-300">GPU{link.gpu_a}</span>
                  <span className="text-zinc-600">↔</span>
                  <span className="text-xs font-mono text-zinc-300">GPU{link.gpu_b}</span>
                </div>

                {/* Bandwidth bar */}
                <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${style.bar}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>

                {/* Link badge */}
                <span className={`px-2 py-0.5 text-[10px] font-mono rounded ${style.badge} whitespace-nowrap`}>
                  {link.link_label || link.link_type}
                </span>

                {/* Dot indicator */}
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-zinc-500 text-center py-2">No interconnect links detected.</p>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-zinc-800 text-[10px] text-zinc-500">
        {[
          { label: 'NVLink', style: linkStyle(100) },
          { label: 'PIX', style: linkStyle(60) },
          { label: 'PXB', style: linkStyle(40) },
          { label: 'PHB', style: linkStyle(20) },
          { label: 'SYS', style: linkStyle(5) },
        ].map(({ label, style }) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
})
