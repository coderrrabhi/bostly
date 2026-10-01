import { Wrench } from "lucide-react";
import logo from "@/assets/logo.png";

const Maintenance = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#FFF6EC] via-white to-[#FFE5F1] px-6">
      <div className="max-w-lg w-full text-center bg-white/80 backdrop-blur-xl border border-[#1D5CFF]/20 rounded-3xl shadow-2xl p-10">
        <img src={logo} alt="Boostly Pro" className="w-20 h-20 mx-auto mb-6 rounded-2xl shadow-lg" />
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#1D5CFF]/10 text-[#1D5CFF] text-sm font-semibold mb-6">
          <Wrench className="w-4 h-4 animate-pulse" />
          Under Maintenance
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-[#0B1E3F] mb-4">
          We'll be right back!
        </h1>
        <p className="text-slate-600 mb-6 leading-relaxed">
          Boostly Pro is currently undergoing scheduled maintenance to bring you a faster, smoother experience.
          All your data, providers, and orders are safe.
        </p>
      </div>
    </div>
  );
};

export default Maintenance;
