"use client";
import React, { useState } from "react";
import Image from "next/image";

interface Message {
    id: string;
    sender: "user" | "support";
    senderName?: string;
    content: string;
    timestamp: Date;
}

interface IssueDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    issue: {
        id: string;
        merchantName: string;
        category: string;
        status: "pending" | "resolved" | "in_progress";
        messages: Message[];
    };
}

const STATUS_OPTIONS = [
    { value: "pending", label: "Pending", color: "bg-yellow-100 text-yellow-800" },
    { value: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-800" },
    { value: "resolved", label: "Resolved", color: "bg-green-100 text-green-800" },
] as const;

const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
    const isUser = message.sender === "user";
    
    return (
        <div className={`flex ${isUser ? "justify-start" : "justify-end"} mb-4`}>
            <div className={`max-w-[80%] ${isUser ? "" : "order-2"}`}>
                {message.senderName && (
                    <p className={`text-xs font-semibold mb-1 ${isUser ? "text-[#4E37FB]" : "text-gray-700"}`}>
                        {message.senderName}
                    </p>
                )}
                <div
                    className={`p-3 rounded-lg ${
                        isUser
                            ? "bg-gray-100 text-gray-800"
                            : "bg-[#4E37FB] text-white"
                    }`}
                >
                    <p className="text-sm leading-relaxed">{message.content}</p>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
            </div>
        </div>
    );
};

const StatusBadge: React.FC<{ 
    status: string; 
    onChange: (status: string) => void;
}> = ({ status, onChange }) => {
    const currentStatus = STATUS_OPTIONS.find(opt => opt.value === status) || STATUS_OPTIONS[0];
    
    return (
        <select
            value={status}
            onChange={(e) => onChange(e.target.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium border-none outline-none cursor-pointer ${currentStatus.color}`}
        >
            {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );
};


const IssueDetailsModal: React.FC<IssueDetailsModalProps> = ({ 
    isOpen, 
    onClose, 
    issue 
}) => {
    const [status, setStatus] = useState(issue.status);
    const [newMessage, setNewMessage] = useState("");
    const [messages, setMessages] = useState(issue.messages);

    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!newMessage.trim()) return;

        const message: Message = {
            id: Date.now().toString(),
            sender: "support",
            content: newMessage,
            timestamp: new Date(),
        };

        setMessages([...messages, message]);
        setNewMessage("");
    };

    const handleStatusChange = (newStatus: string) => {
        setStatus(newStatus as typeof issue.status);
        // Here you would typically make an API call to update the status
        console.log("Status updated to:", newStatus);
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Overlay */}
            <div
                onClick={onClose}
                className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm"
            />

            {/* Modal */}
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-[600px] h-[80vh] bg-white rounded-lg shadow-2xl z-50 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold">Issue {issue.id} Details</h2>
                        <StatusBadge status={status} onChange={handleStatusChange} />
                    </div>
                    <button
                        onClick={onClose}
                        className="hover:bg-gray-100 p-1 rounded transition-colors"
                        aria-label="Close"
                    >
                        <Image
                            src="/icons/close.svg"
                            alt="close"
                            width={20}
                            height={20}
                        />
                    </button>
                </div>

                {/* Issue Info */}
                <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 border-b">
                    <div>
                        <p className="text-xs text-gray-500 mb-1">Merchant name</p>
                        <p className="text-sm font-medium text-[#4E37FB]">{issue.merchantName}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 mb-1">Issue category</p>
                        <p className="text-sm font-medium">{issue.category}</p>
                    </div>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((message) => (
                        <MessageBubble key={message.id} message={message} />
                    ))}
                </div>

                {/* Message Input */}
                <form 
                    onSubmit={handleSendMessage}
                    className="border-t p-4 bg-white"
                >
                    <div className="flex gap-2 items-center">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type here..."
                            className="flex-1 h-[45px] border border-gray-300 px-4 rounded-lg outline-none focus:border-[#4E37FB] transition-colors"
                        />
                        <button
                            type="submit"
                            disabled={!newMessage.trim()}
                            className="h-[45px] w-[45px] bg-[#4E37FB] rounded-lg flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Send message"
                        >
                            <svg 
                                width="20" 
                                height="20" 
                                viewBox="0 0 24 24" 
                                fill="none" 
                                stroke="white" 
                                strokeWidth="2"
                                strokeLinecap="round" 
                                strokeLinejoin="round"
                            >
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
};

export default IssueDetailsModal;

// ============================================================================
// USAGE EXAMPLE
// ============================================================================
/*
const ExampleUsage = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    const sampleIssue = {
        id: "USR01A02",
        merchantName: "Daniss Microfinance bank, Lagos",
        category: "Payment",
        status: "pending" as const,
        messages: [
            {
                id: "1",
                sender: "user" as const,
                senderName: "DM",
                content: "I made a payment for my subscription but I am still on a free plan. I would need to know what happened and what to do next",
                timestamp: new Date(),
            },
            {
                id: "2",
                sender: "user" as const,
                senderName: "DM",
                content: "I made a payment for my subscription but I am still on a free plan. I would need to know what happened and what to do next",
                timestamp: new Date(),
            },
        ],
    };

    return (
        <>
            <button onClick={() => setIsModalOpen(true)}>
                View Issue Details
            </button>
            
            <IssueDetailsModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                issue={sampleIssue}
            />
        </>
    );
};
*/