"use client"
import React, { useState } from "react"
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
} from "recharts";


const Charts = () => {

    const data = [
        { name: "Jan", merchants: 90000, active: 70000, inactive: 20000 },
        { name: "Feb", merchants: 85000, active: 65000, inactive: 20000 },
        { name: "Mar", merchants: 100000, active: 80000, inactive: 20000 },
        { name: "Apr", merchants: 180000, active: 160000, inactive: 20000 },
        { name: "May", merchants: 120000, active: 100000, inactive: 20000 },
        { name: "Jun", merchants: 150000, active: 130000, inactive: 20000 },
        { name: "Jul", merchants: 130000, active: 100000, inactive: 30000 },
        { name: "Aug", merchants: 190000, active: 150000, inactive: 40000 },
        { name: "Sep", merchants: 170000, active: 140000, inactive: 30000 },
        { name: "Oct", merchants: 160000, active: 130000, inactive: 30000 },
        { name: "Nov", merchants: 150000, active: 120000, inactive: 30000 },
        { name: "Dec", merchants: 140000, active: 110000, inactive: 30000 },
    ];

    const [range, setRange] = useState("Last 12 months");

    const piedata = [
        { name: "Standard", value: 25 },
        { name: "Custom", value: 75 },
    ];

    const COLORS = ["#C7B9FF", "#2F85A5"];


    const dataToShow =
        range === "Last 6 months" ? data.slice(-6) : data;

    const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
        cx?: number;
        cy?: number;
        midAngle?: number;
        innerRadius?: number;
        outerRadius?: number;
        percent?: number;
    }) => {
        if (cx === undefined || cy === undefined || midAngle === undefined || innerRadius === undefined || outerRadius === undefined || percent === undefined) {
            return null;
        }
        const numCx = Number(cx);
        const numCy = Number(cy);
        const numMidAngle = Number(midAngle);
        const numInnerRadius = Number(innerRadius);
        const numOuterRadius = Number(outerRadius);

        const radius = numInnerRadius + (numOuterRadius - numInnerRadius) * 0.5;
        const x = numCx + radius * Math.cos(-numMidAngle * Math.PI / 180);
        const y = numCy + radius * Math.sin(-numMidAngle * Math.PI / 180);

        return (
            <text
                x={x}
                y={y}
                fill="black"
                textAnchor={x > numCx ? 'start' : 'end'}
                dominantBaseline="central"
                fontSize={12}
            >
                {`${(percent * 100).toFixed(0)}%`}
            </text>
        );
    };

    const totalValue = piedata.reduce((sum, entry) => sum + entry.value, 0);



    return (
        <div>
            <div className="flex flex-col lg:flex-row gap-4 mt-5">
                <div className="w-full lg:w-2/3">
                    <div className="p-5 rounded-lg bg-white dark:bg-gray-900 dark:text-white dark:bg-gray-900 dark:border dark:border-gray-700 shadow-sm">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
                            <p className="text-xl font-semibold text-gray-900">Merchant Growth</p>
                            <div className="relative mt-4 sm:mt-0 w-full sm:w-1/2 md:w-1/3">
                                <select
                                    className="w-full px-3 py-1.5 border outline-none border-gray-300 rounded-md appearance-none bg-white dark:bg-gray-900 dark:text-white dark:bg-gray-900 dark:border dark:border-gray-700 pr-10"
                                    value={range}
                                    onChange={(e) => setRange(e.target.value)}
                                >
                                    <option value="Last 12 months">Last 12 months</option>
                                    <option value="Last 6 months">Last 6 months</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                        <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 w-full h-80">
                            <ResponsiveContainer width="100%" height={300} >
                                <BarChart data={dataToShow} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%" barGap={2} >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                                    <YAxis axisLine={false} tickLine={false}
                                        tickFormatter={(value) => `${value}`} />
                                    <Tooltip cursor={{ fill: 'transparent' }} />
                                    <Legend verticalAlign="top" align="center" height={36} />
                                    <Bar dataKey="merchants" fill="#B0A9F4" barSize={10} />
                                    <Bar dataKey="active" fill="#A2D9A0" barSize={10} />
                                    <Bar dataKey="inactive" fill="#5A9BD5" barSize={10} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>


                <div className="w-full lg:w-1/3">
                    <div className="p-5 rounded-lg bg-white dark:bg-gray-900  dark:bg-gray-900 dark:border dark:border-gray-700 shadow-sm h-full flex flex-col justify-between">
                        <p className="text-xl font-semibold text-gray-900 dark:text-white">Merchants by Subscription Plan</p>
                        <div className="flex flex-col relative items-center justify-center flex-grow relative">
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-2xl font-bold text-gray-800 dark:text-white">{totalValue}</span>
                            </div>

                            <ResponsiveContainer width="100%" height={250}>
                                <PieChart>
                                    <Pie
                                        data={piedata}
                                        dataKey="value"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={3}
                                        fill="#8884d8"
                                        startAngle={90}
                                        endAngle={450}
                                        label={(props) => CustomLabel(props as any)}
                                        labelLine={false}
                                    >
                                        {piedata.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>

                                </PieChart>
                            </ResponsiveContainer>

                        </div>
                        <div className="flex justify-center space-x-6">
                            {piedata.map((entry, index) => (
                                <div key={`legend-${index}`} className="flex items-center space-x-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }}></div>
                                    <span className="text-[16px] font-inter font-medium text-gray-700 dark:text-white">{entry.name}</span>
                                </div>
                            ))}
                        </div>

                    </div>
                </div>
            </div>

        </div>
    )
}

export default Charts;