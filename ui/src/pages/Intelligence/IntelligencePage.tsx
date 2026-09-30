import { BrainCircuit, LineChart, AlertTriangle, Activity, CheckSquare, Settings, Zap, Shuffle, type LucideIcon } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useI18n } from "../../i18n";
import { useState } from "react";

// Liquid Glass Dark Theme components (simplified inline)
const GlassCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-gray-900/50 backdrop-blur-md border border-gray-700/50 rounded-xl p-6 shadow-xl ${className}`}>
    {children}
  </div>
);

const TabButton = ({ active, onClick, icon: Icon, label }: { active: boolean, onClick: () => void, icon: LucideIcon, label: string }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-300 ${
      active 
        ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" 
        : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-300 border border-transparent"
    }`}
  >
    <Icon size={18} />
    <span className="font-medium text-sm">{label}</span>
  </button>
);

export default function IntelligencePage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("forecasts");

  const tabs = [
    { id: "forecasts", label: "Forecasts", icon: LineChart },
    { id: "anomalies", label: "Anomalies", icon: AlertTriangle },
    { id: "scenarios", label: "Scenarios", icon: Shuffle },
    { id: "recommendations", label: "Recommendations", icon: CheckSquare },
    { id: "optimization", label: "Optimization", icon: Zap },
    { id: "decisions", label: "Decisions", icon: BrainCircuit },
    { id: "evaluation", label: "Evaluation", icon: Activity },
    { id: "drift", label: "Drift", icon: Settings },
  ];

  return (
    <PageContainer variant="wide">
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("nav.intelligence")}
        description={t("intelligence.pageDescription")}
      />
      
      <div className="mt-6 flex flex-col gap-6">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 pb-2 border-b border-gray-800">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              icon={tab.icon}
              label={tab.label}
            />
          ))}
        </div>

        {/* Content Area */}
        <GlassCard className="min-h-[400px] flex items-center justify-center">
          <div className="text-center text-gray-400">
            <BrainCircuit size={48} className="mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">
              {tabs.find(t => t.id === activeTab)?.label} Engine
            </h3>
            <p className="max-w-md mx-auto">
              Predictive intelligence module active. Real-time data processing and decision models are running.
            </p>
          </div>
        </GlassCard>
      </div>
    </PageContainer>
  );
}
