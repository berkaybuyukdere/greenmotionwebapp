import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, onSnapshot, query, orderBy, limit, Timestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import { format } from 'date-fns';
import { 
    Camera, Car, Home, LogOut, Plus, Trash2, X, Search, FileText, Clock, Calendar, Package, Activity, 
    ChevronRight, Download, ArrowLeft, Edit, Building2, CreditCard, Fuel, Droplet, DollarSign, 
    TrendingUp, PieChart as PieChartIcon, BarChart3, Users, Settings, Eye, Filter, Save, Upload, Image as ImageIcon,
    CheckCircle, XCircle, AlertCircle, Printer, FileSpreadsheet, MapPin, Phone, Mail, Globe, Wrench,
    Grid, List, Key, FileCheck
} from 'lucide-react';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend);

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBvQZJ8QZJ8QZJ8QZJ8QZJ8QZJ8QZJ8QZJ8",
    authDomain: "greenmotion-12345.firebaseapp.com",
    projectId: "greenmotion-12345",
    storageBucket: "greenmotion-12345.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentView, setCurrentView] = useState('dashboard');
    const [userProfile, setUserProfile] = useState(null);
    
    // Data states
    const [cars, setCars] = useState([]);
    const [services, setServices] = useState([]);
    const [returns, setReturns] = useState([]);
    const [activities, setActivities] = useState([]);
    const [officeOperations, setOfficeOperations] = useState([]);
    const [serviceFirms, setServiceFirms] = useState([]);
    
    // ERP Data states
    const [erpTransactions, setErpTransactions] = useState([]);
    const [erpCustomers, setErpCustomers] = useState([]);
    const [erpAccidents, setErpAccidents] = useState([]);
    const [erpProtocols, setErpProtocols] = useState([]);
    const [erpAccidentCodes, setErpAccidentCodes] = useState([]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setUser(user);
            if (user) {
                await loadUserProfile(user.uid);
                setupRealTimeListeners();
            }
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    const loadUserProfile = async (uid) => {
        try {
            const userDoc = await getDocs(collection(db, 'users'));
            const userData = userDoc.docs.find(doc => doc.id === uid);
            if (userData) {
                setUserProfile(userData.data());
            }
        } catch (error) {
            console.error('Error loading user profile:', error);
        }
    };

    const setupRealTimeListeners = () => {
        const unsubscribeCars = onSnapshot(collection(db, 'araclar'), (snapshot) => {
            setCars(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const unsubscribeServices = onSnapshot(collection(db, 'servisKayitlari'), (snapshot) => {
            setServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const unsubscribeReturns = onSnapshot(collection(db, 'iadeIslemleri'), (snapshot) => {
            setReturns(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const unsubscribeActivities = onSnapshot(
            query(collection(db, 'activities'), orderBy('tarih', 'desc'), limit(50)),
            (snapshot) => {
                setActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            }
        );
        
        const unsubscribeOfficeOps = onSnapshot(collection(db, 'office_operations'), (snapshot) => {
            setOfficeOperations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const unsubscribeFirms = onSnapshot(collection(db, 'servisFirmalari'), (snapshot) => {
            setServiceFirms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        // ERP Data listeners
        const unsubscribeErpTransactions = onSnapshot(collection(db, 'transactions'), (snapshot) => {
            setErpTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const unsubscribeErpCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
            setErpCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const unsubscribeErpAccidents = onSnapshot(collection(db, 'accidents'), (snapshot) => {
            setErpAccidents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const unsubscribeErpProtocols = onSnapshot(collection(db, 'protocols'), (snapshot) => {
            setErpProtocols(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        const unsubscribeErpAccidentCodes = onSnapshot(collection(db, 'accidentCodes'), (snapshot) => {
            setErpAccidentCodes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => {
            unsubscribeCars();
            unsubscribeServices();
            unsubscribeReturns();
            unsubscribeActivities();
            unsubscribeOfficeOps();
            unsubscribeFirms();
            unsubscribeErpTransactions();
            unsubscribeErpCustomers();
            unsubscribeErpAccidents();
            unsubscribeErpProtocols();
            unsubscribeErpAccidentCodes();
        };
    };

    const loadData = async () => {
        try {
            const [carsSnapshot, servicesSnapshot, returnsSnapshot, activitiesSnapshot, officeOpsSnapshot, firmsSnapshot] = await Promise.all([
                getDocs(collection(db, 'araclar')),
                getDocs(collection(db, 'servisKayitlari')),
                getDocs(collection(db, 'iadeIslemleri')),
                getDocs(query(collection(db, 'activities'), orderBy('tarih', 'desc'), limit(50))),
                getDocs(collection(db, 'office_operations')),
                getDocs(collection(db, 'servisFirmalari'))
            ]);

            setCars(carsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setServices(servicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setReturns(returnsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setActivities(activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setOfficeOperations(officeOpsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setServiceFirms(firmsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (error) {
            console.error('Error loading data:', error);
        }
    };

    const addActivity = (title, description) => {
        const activity = {
            baslik: title,
            aciklama: description,
            tarih: Timestamp.now(),
            kullanici: user?.email || 'Unknown'
        };
        
        addDoc(collection(db, 'activities'), activity);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return <LoginScreen />;
    }

    return (
        <div className="min-h-screen bg-gray-50 flex">
            <Sidebar currentView={currentView} setCurrentView={setCurrentView} userProfile={userProfile} />
            
            <div className="flex-1 flex flex-col">
                <div className="bg-white border-b border-gray-200 px-6 py-4">
                    <div className="flex items-center justify-between">
                        <h1 className="text-2xl font-bold text-gray-900">
                            {currentView === 'dashboard' && 'Dashboard'}
                            {currentView === 'cars' && 'Vehicles'}
                            {currentView === 'returns' && 'Returns'}
                            {currentView === 'service' && 'Service Records'}
                            {currentView === 'serviceFirms' && 'Service Firms'}
                            {currentView === 'office' && 'Office Operations'}
                            {currentView === 'analytics' && 'Analytics'}
                            {currentView === 'erp' && 'ERP Data'}
                            {currentView === 'reports' && 'Reports'}
                        </h1>
                        <div className="flex items-center gap-4">
                            <div className="text-sm text-gray-600">
                                Welcome, {userProfile?.name || user.email}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-auto">
                    <div className="p-8">
                        {currentView === 'dashboard' && <Dashboard cars={cars} services={services} returns={returns} activities={activities} officeOperations={officeOperations} setCurrentView={setCurrentView} />}
                        {currentView === 'cars' && <CarsView cars={cars} onRefresh={loadData} addActivity={addActivity} />}
                        {currentView === 'returns' && <ReturnsView returns={returns} cars={cars} onRefresh={loadData} addActivity={addActivity} />}
                        {currentView === 'analytics' && <AnalyticsView cars={cars} services={services} returns={returns} officeOperations={officeOperations} activities={activities} />}
                        {currentView === 'erp' && <ErpDataView erpTransactions={erpTransactions} erpCustomers={erpCustomers} erpAccidents={erpAccidents} erpProtocols={erpProtocols} erpAccidentCodes={erpAccidentCodes} />}
                        {currentView === 'service' && <ServiceView services={services} cars={cars} serviceFirms={serviceFirms} onRefresh={loadData} addActivity={addActivity} />}
                        {currentView === 'serviceFirms' && <ServiceFirmsView firms={serviceFirms} onRefresh={loadData} addActivity={addActivity} />}
                        {currentView === 'office' && <OfficeOperationsView operations={officeOperations} cars={cars} onRefresh={loadData} addActivity={addActivity} />}
                        {currentView === 'reports' && <ReportsView cars={cars} returns={returns} officeOperations={officeOperations} />}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Sidebar({ currentView, setCurrentView, userProfile }) {
    return (
        <div className="w-72 bg-white border-r border-gray-200 flex flex-col shadow-lg">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-br from-blue-50 to-white">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                        <Car className="text-white" size={24} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Green Motion</h1>
                        <p className="text-sm text-gray-600">Vehicle Management</p>
                    </div>
                </div>
            </div>

            <nav className="flex-1 p-4 space-y-2">
                <NavButton icon={<Home size={20} />} label="Dashboard" active={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} />
                <NavButton icon={<Car size={20} />} label="Vehicles" active={currentView === 'cars'} onClick={() => setCurrentView('cars')} />
                <NavButton icon={<ArrowLeft size={20} />} label="Returns" active={currentView === 'returns'} onClick={() => setCurrentView('returns')} />
                <NavButton icon={<Package size={20} />} label="Service" active={currentView === 'service'} onClick={() => setCurrentView('service')} />
                <NavButton icon={<Building2 size={20} />} label="Service Firms" active={currentView === 'serviceFirms'} onClick={() => setCurrentView('serviceFirms')} />
                <NavButton icon={<DollarSign size={20} />} label="Office Operations" active={currentView === 'office'} onClick={() => setCurrentView('office')} />
                <NavButton icon={<BarChart3 size={20} />} label="Analytics" active={currentView === 'analytics'} onClick={() => setCurrentView('analytics')} />
                <NavButton icon={<FileSpreadsheet size={20} />} label="ERP Data" active={currentView === 'erp'} onClick={() => setCurrentView('erp')} />
                <NavButton icon={<FileText size={20} />} label="Reports" active={currentView === 'reports'} onClick={() => setCurrentView('reports')} />
            </nav>

            <div className="p-4 border-t border-gray-200 bg-gray-50">
                <button onClick={() => signOut(auth)} className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-all font-medium">
                    <LogOut size={20} />
                    <span>Sign Out</span>
                </button>
            </div>
        </div>
    );
}

function NavButton({ icon, label, active, onClick }) {
    return (
        <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${
            active 
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30' 
                : 'text-gray-700 hover:bg-gray-100'
        }`}>
            {icon}
            <span>{label}</span>
        </button>
    );
}

function LoginScreen() {
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            if (isSignUp) {
                await createUserWithEmailAndPassword(auth, email, password);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
        } catch (error) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-8 w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Car className="text-white" size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Green Motion</h1>
                    <p className="text-gray-600 mt-1">Vehicle Management System</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                               className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                               required />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                               className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                               required />
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <button type="submit" disabled={loading}
                            className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl transition-all shadow-lg shadow-blue-500/30 font-medium disabled:opacity-50">
                        {loading ? 'Loading...' : (isSignUp ? 'Sign Up' : 'Sign In')}
                    </button>

                    <button type="button" onClick={() => setIsSignUp(!isSignUp)}
                            className="w-full text-center text-blue-600 hover:text-blue-700 font-medium">
                        {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                    </button>
                </form>
            </div>
        </div>
    );
}

// Utility functions
const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    let date;
    if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
    } else if (typeof timestamp === 'number') {
        const millisSince2001 = timestamp * 1000;
        const referenceDateMillis = new Date('2001-01-01T00:00:00Z').getTime();
        date = new Date(referenceDateMillis + millisSince2001);
    } else {
        date = new Date(timestamp);
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    let date;
    if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
    } else if (typeof timestamp === 'number') {
        const millisSince2001 = timestamp * 1000;
        const referenceDateMillis = new Date('2001-01-01T00:00:00Z').getTime();
        date = new Date(referenceDateMillis + millisSince2001);
    } else {
        date = new Date(timestamp);
    }
    return date.toLocaleString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount || 0);
};

// PDF Generation Helper Functions
const loadImageAsDataURL = (url, addTimestamp = true) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            if (addTimestamp) {
                const timestamp = format(new Date(), 'dd.MM.yyyy HH:mm:ss');
                ctx.font = `bold ${Math.max(16, canvas.width * 0.03)}px Arial`;
                ctx.fillStyle = '#EF4444';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 4;
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;
                ctx.textBaseline = 'bottom';
                ctx.fillText(timestamp, canvas.width - ctx.measureText(timestamp).width - 10, canvas.height - 10);
            }
            
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
};

const generateDamagePDF = async (car) => {
    const pdf = new jsPDF();
    
    // Header
    pdf.setFillColor(59, 130, 246);
    pdf.rect(0, 0, 210, 30, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.text('GREEN MOTION AG', 20, 20);
    pdf.setFontSize(14);
    pdf.text('Vehicle Damage Report', 20, 25);
    
    let yPos = 50;
    
    // Vehicle Information
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(16);
    pdf.text('Vehicle Information', 20, yPos);
    yPos += 10;
    
    const vehicleData = [
        ['License Plate', car.plaka || 'N/A'],
        ['Brand', car.marka || 'N/A'],
        ['Model', car.model || 'N/A'],
        ['Category', car.kategori || 'N/A'],
        ['Color', car.renk || 'N/A'],
        ['KM', car.km || 'N/A'],
        ['Report Date', format(new Date(), 'dd.MM.yyyy')]
    ];
    
    pdf.autoTable({
        startY: yPos,
        head: [['Field', 'Value']],
        body: vehicleData,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246] },
        styles: { fontSize: 10 }
    });
    
    yPos = pdf.lastAutoTable.finalY + 20;
    
    // Damage Records
    if (car.hasarKayitlari && car.hasarKayitlari.length > 0) {
        car.hasarKayitlari.forEach((hasar, index) => {
            if (yPos > 250) {
                pdf.addPage();
                yPos = 20;
            }
            
            pdf.setFontSize(14);
            pdf.text(`Damage Record ${index + 1}`, 20, yPos);
            yPos += 10;
            
            const damageData = [
                ['Status', hasar.durum || 'N/A'],
                ['KM', hasar.km || 'N/A'],
                ['Date', formatDate(hasar.tarih)],
                ['Handover Date', formatDate(hasar.handoverTarihi)]
            ];
            
            pdf.autoTable({
                startY: yPos,
                head: [['Field', 'Value']],
                body: damageData,
                theme: 'grid',
                headStyles: { fillColor: [239, 68, 68] },
                styles: { fontSize: 10 }
            });
            
            yPos = pdf.lastAutoTable.finalY + 20;
            
            // Photos in 2x2 grid
            if (hasar.fotograflar && hasar.fotograflar.length > 0) {
                pdf.setFontSize(12);
                pdf.text('Photos:', 20, yPos);
                yPos += 10;
                
                const photos = hasar.fotograflar.slice(0, 4);
                const photoSize = 40;
                const spacing = 50;
                
                for (let i = 0; i < photos.length; i++) {
                    const row = Math.floor(i / 2);
                    const col = i % 2;
                    const x = 20 + col * spacing;
                    const y = yPos + row * (photoSize + 10);
                    
                    try {
                        const dataUrl = await loadImageAsDataURL(photos[i], true);
                        if (dataUrl) {
                            pdf.addImage(dataUrl, 'JPEG', x, y, photoSize, photoSize);
                            pdf.rect(x, y, photoSize, photoSize);
                        }
                    } catch (error) {
                        console.error('Error loading image:', error);
                    }
                }
                
                yPos += (Math.ceil(photos.length / 2) * (photoSize + 10)) + 20;
            }
        });
    }
    
    pdf.save(`Damage_Report_${car.plaka}_${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`);
};

const generateOfficePDF = async (operations) => {
    const pdf = new jsPDF();
    
    // Header
    pdf.setFillColor(34, 197, 94);
    pdf.rect(0, 0, 210, 30, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.text('GREEN MOTION AG', 20, 20);
    pdf.setFontSize(14);
    pdf.text('Office Operations Report', 20, 25);
    
    let yPos = 50;
    
    // Financial Summary
    const totals = {
        creditCard: operations.filter(op => op.type === 'Credit Card Receipt').reduce((sum, op) => sum + (op.amount || 0), 0),
        pos: operations.filter(op => op.type === 'POS Daily Closing').reduce((sum, op) => sum + (op.amount || 0), 0),
        fuel: operations.filter(op => op.type === 'Fuel Receipt').reduce((sum, op) => sum + (op.amount || 0), 0),
        washing: operations.filter(op => op.type === 'Washing Expense').reduce((sum, op) => sum + (op.amount || 0), 0)
    };
    
    pdf.setFontSize(16);
    pdf.text('Financial Summary', 20, yPos);
    yPos += 10;
    
    const summaryData = [
        ['Credit Card Receipts', formatCurrency(totals.creditCard)],
        ['POS Daily Closing', formatCurrency(totals.pos)],
        ['Fuel Receipts', formatCurrency(totals.fuel)],
        ['Washing Expenses', formatCurrency(totals.washing)],
        ['Total', formatCurrency(totals.creditCard + totals.pos + totals.fuel + totals.washing)]
    ];
    
    pdf.autoTable({
        startY: yPos,
        head: [['Category', 'Amount']],
        body: summaryData,
        theme: 'grid',
        headStyles: { fillColor: [34, 197, 94] },
        styles: { fontSize: 10 }
    });
    
    yPos = pdf.lastAutoTable.finalY + 20;
    
    // Detailed Operations
    pdf.setFontSize(16);
    pdf.text('Detailed Operations', 20, yPos);
    yPos += 10;
    
    const operationsData = operations.map(op => [
        formatDate(op.date),
        op.type || 'N/A',
        formatCurrency(op.amount || 0),
        op.description || 'N/A'
    ]);
    
    pdf.autoTable({
        startY: yPos,
        head: [['Date', 'Type', 'Amount', 'Description']],
        body: operationsData,
        theme: 'grid',
        headStyles: { fillColor: [34, 197, 94] },
        styles: { fontSize: 8 }
    });
    
    yPos = pdf.lastAutoTable.finalY + 20;
    
    // Photos
    const operationsWithPhotos = operations.filter(op => op.photos && op.photos.length > 0);
    if (operationsWithPhotos.length > 0) {
        pdf.setFontSize(16);
        pdf.text('Operation Photos', 20, yPos);
        yPos += 10;
        
        let photoIndex = 0;
        for (const op of operationsWithPhotos.slice(0, 6)) {
            for (const photoUrl of op.photos.slice(0, 3)) {
                if (yPos > 250) {
                    pdf.addPage();
                    yPos = 20;
                }
                
                const row = Math.floor(photoIndex / 3);
                const col = photoIndex % 3;
                const x = 20 + col * 60;
                const y = yPos + row * 50;
                
                try {
                    const dataUrl = await loadImageAsDataURL(photoUrl, true);
                    if (dataUrl) {
                        pdf.addImage(dataUrl, 'JPEG', x, y, 50, 40);
                        pdf.rect(x, y, 50, 40);
                        pdf.setFontSize(8);
                        pdf.text(`${op.type} - ${formatDate(op.date)}`, x, y + 45);
                    }
                } catch (error) {
                    console.error('Error loading image:', error);
                }
                
                photoIndex++;
            }
        }
    }
    
    pdf.save(`Office_Operations_Report_${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`);
};

const generateReturnsPDF = async (returns) => {
    const pdf = new jsPDF();
    
    // Header
    pdf.setFillColor(147, 51, 234);
    pdf.rect(0, 0, 210, 30, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.text('GREEN MOTION AG', 20, 20);
    pdf.setFontSize(14);
    pdf.text('Returns Report', 20, 25);
    
    let yPos = 50;
    
    // Returns Summary
    const totalReturns = returns.length;
    const totalValue = returns.reduce((sum, ret) => sum + (parseFloat(ret.tutar) || 0), 0);
    
    pdf.setFontSize(16);
    pdf.text('Returns Summary', 20, yPos);
    yPos += 10;
    
    const summaryData = [
        ['Total Returns', totalReturns],
        ['Total Value', formatCurrency(totalValue)],
        ['Report Date', format(new Date(), 'dd.MM.yyyy')]
    ];
    
    pdf.autoTable({
        startY: yPos,
        head: [['Metric', 'Value']],
        body: summaryData,
        theme: 'grid',
        headStyles: { fillColor: [147, 51, 234] },
        styles: { fontSize: 10 }
    });
    
    yPos = pdf.lastAutoTable.finalY + 20;
    
    // Return Details
    pdf.setFontSize(16);
    pdf.text('Return Details', 20, yPos);
    yPos += 10;
    
    const returnsData = returns.map(ret => [
        ret.aracPlaka || 'N/A',
        formatDate(ret.iadeTarihi),
        formatCurrency(parseFloat(ret.tutar) || 0),
        ret.notlar || 'N/A'
    ]);
    
    pdf.autoTable({
        startY: yPos,
        head: [['Vehicle', 'Return Date', 'Amount', 'Notes']],
        body: returnsData,
        theme: 'grid',
        headStyles: { fillColor: [147, 51, 234] },
        styles: { fontSize: 8 }
    });
    
    yPos = pdf.lastAutoTable.finalY + 20;
    
    // Return Photos
    const returnsWithPhotos = returns.filter(ret => ret.fotograflar && ret.fotograflar.length > 0);
    if (returnsWithPhotos.length > 0) {
        pdf.setFontSize(16);
        pdf.text('Return Photos', 20, yPos);
        yPos += 10;
        
        let photoIndex = 0;
        for (const ret of returnsWithPhotos.slice(0, 6)) {
            for (const photoUrl of ret.fotograflar.slice(0, 3)) {
                if (yPos > 250) {
                    pdf.addPage();
                    yPos = 20;
                }
                
                const row = Math.floor(photoIndex / 3);
                const col = photoIndex % 3;
                const x = 20 + col * 60;
                const y = yPos + row * 50;
                
                try {
                    const dataUrl = await loadImageAsDataURL(photoUrl, true);
                    if (dataUrl) {
                        pdf.addImage(dataUrl, 'JPEG', x, y, 50, 40);
                        pdf.rect(x, y, 50, 40);
                        pdf.setFontSize(8);
                        pdf.text(`${ret.aracPlaka} - ${formatDate(ret.iadeTarihi)}`, x, y + 45);
                    }
                } catch (error) {
                    console.error('Error loading image:', error);
                }
                
                photoIndex++;
            }
        }
    }
    
    pdf.save(`Returns_Report_${format(new Date(), 'yyyyMMdd_HHmmss')}.pdf`);
};

// Dashboard Component
function Dashboard({ cars, services, returns, activities, officeOperations, setCurrentView }) {
    const damagedCars = cars.filter(car => car.hasarKayitlari?.length > 0);
    const inProgressDamages = damagedCars.filter(car => 
        car.hasarKayitlari?.some(h => h.durum === 'In Progress')
    );
    const completedServices = services.filter(s => s.durum === 'Completed');
    const totalReturns = returns.length;
    
    const creditCardTotal = officeOperations.filter(op => op.type === 'Credit Card Receipt').reduce((sum, op) => sum + (op.amount || 0), 0);
    const posTotal = officeOperations.filter(op => op.type === 'POS Daily Closing').reduce((sum, op) => sum + (op.amount || 0), 0);
    const fuelTotal = officeOperations.filter(op => op.type === 'Fuel Receipt').reduce((sum, op) => sum + (op.amount || 0), 0);
    const washingTotal = officeOperations.filter(op => op.type === 'Washing Expense').reduce((sum, op) => sum + (op.amount || 0), 0);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                <p className="text-gray-600 mt-1">Overview of your vehicle management system</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title="Total Vehicles" value={cars.length} icon={<Car className="text-blue-500" size={28} />} color="blue" trend="+12%" onClick={() => setCurrentView('cars')} />
                <StatCard title="Active Damages" value={inProgressDamages.length} icon={<AlertCircle className="text-orange-500" size={28} />} color="orange" trend="+5%" onClick={() => setCurrentView('cars')} />
                <StatCard title="Completed Services" value={completedServices.length} icon={<CheckCircle className="text-green-500" size={28} />} color="green" trend="+18%" onClick={() => setCurrentView('service')} />
                <StatCard title="Total Returns" value={totalReturns} icon={<ArrowLeft className="text-purple-500" size={28} />} color="purple" trend="+8%" onClick={() => setCurrentView('returns')} />
            </div>

            {/* Financial Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-blue-600 text-sm font-medium">Credit Card</p>
                            <p className="text-2xl font-bold text-blue-900">{formatCurrency(creditCardTotal)}</p>
                        </div>
                        <CreditCard className="text-blue-500" size={32} />
                    </div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-green-600 text-sm font-medium">POS Closing</p>
                            <p className="text-2xl font-bold text-green-900">{formatCurrency(posTotal)}</p>
                        </div>
                        <DollarSign className="text-green-500" size={32} />
                    </div>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-orange-600 text-sm font-medium">Fuel</p>
                            <p className="text-2xl font-bold text-orange-900">{formatCurrency(fuelTotal)}</p>
                        </div>
                        <Fuel className="text-orange-500" size={32} />
                    </div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-purple-600 text-sm font-medium">Washing</p>
                            <p className="text-2xl font-bold text-purple-900">{formatCurrency(washingTotal)}</p>
                        </div>
                        <Droplet className="text-purple-500" size={32} />
                    </div>
                </div>
            </div>

            {/* Recent Activities */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Activities</h2>
                <div className="space-y-3">
                    {activities.slice(0, 5).map((activity, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <div className="flex-1">
                                <p className="font-medium text-gray-900">{activity.baslik}</p>
                                <p className="text-sm text-gray-600">{activity.aciklama}</p>
                            </div>
                            <div className="text-sm text-gray-500">{formatDateTime(activity.tarih)}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, icon, color, trend, onClick }) {
    const colors = {
        blue: 'from-blue-50 to-blue-100 border-blue-200',
        orange: 'from-orange-50 to-orange-100 border-orange-200',
        green: 'from-green-50 to-green-100 border-green-200',
        purple: 'from-purple-50 to-purple-100 border-purple-200'
    };

    return (
        <div
            onClick={onClick}
            className={`bg-gradient-to-br ${colors[color]} rounded-2xl border p-6 shadow-lg shadow-gray-200/50 hover:shadow-xl transition-all ${onClick ? 'cursor-pointer hover:scale-105 transform' : ''}`}
        >
            <div className="flex items-center justify-between mb-4">
                {icon}
                <span className="text-sm font-medium text-gray-600">{trend}</span>
            </div>
            <div className="text-4xl font-bold text-gray-900 mb-2">{value}</div>
            <h3 className="text-gray-700 font-medium">{title}</h3>
        </div>
    );
}

// ERP DATA VIEW Component
function ErpDataView({ erpTransactions, erpCustomers, erpAccidents, erpProtocols, erpAccidentCodes }) {
    const [activeTab, setActiveTab] = useState('transactions');
    const [selectedItem, setSelectedItem] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">ERP Data Management</h1>
                <p className="text-gray-600 mt-1">View and manage ERP system data from Firestore</p>
            </div>
            
            {/* Tabs */}
            <div className="bg-white rounded-2xl border border-gray-200 p-2">
                <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setActiveTab('transactions')}
                            className={`px-6 py-3 rounded-xl font-medium transition-all ${activeTab === 'transactions' ? 'bg-blue-500 text-white shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        Transactions ({erpTransactions.length})
                    </button>
                    <button onClick={() => setActiveTab('customers')}
                            className={`px-6 py-3 rounded-xl font-medium transition-all ${activeTab === 'customers' ? 'bg-green-500 text-white shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        Customers ({erpCustomers.length})
                    </button>
                    <button onClick={() => setActiveTab('accidents')}
                            className={`px-6 py-3 rounded-xl font-medium transition-all ${activeTab === 'accidents' ? 'bg-red-500 text-white shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        Accidents ({erpAccidents.length})
                    </button>
                    <button onClick={() => setActiveTab('protocols')}
                            className={`px-6 py-3 rounded-xl font-medium transition-all ${activeTab === 'protocols' ? 'bg-purple-500 text-white shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        Protocols ({erpProtocols.length})
                    </button>
                </div>
            </div>
            
            {/* Transactions */}
            {activeTab === 'transactions' && (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b bg-blue-50">
                        <h2 className="text-xl font-bold text-blue-900">Transactions</h2>
                        <p className="text-sm text-blue-700 mt-1">Total: {formatCurrency(erpTransactions.reduce((s, t) => s + (parseFloat(t.totalAmount) || 0), 0))}</p>
                    </div>
                    <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">RES</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {erpTransactions.length === 0 ? (
                                    <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500">No transactions found</td></tr>
                                ) : (
                                    erpTransactions.slice(0, 100).map((tx) => (
                                        <tr key={tx.transactionId || tx.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedItem(tx); setShowDetailModal(true); }}>
                                            <td className="px-4 py-3 text-sm text-gray-900">{tx.transactionDate?.substring(0, 10) || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{tx.customerName || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{tx.vehiclePlate || '-'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{tx.resCode || '-'}</td>
                                            <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatCurrency(parseFloat(tx.totalAmount) || 0)}</td>
                                            <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${tx.status === 'PAID' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{tx.status || 'PENDING'}</span></td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {/* Customers */}
            {activeTab === 'customers' && (
                <div className="bg-white rounded-2xl border overflow-hidden">
                    <div className="p-6 border-b bg-green-50">
                        <h2 className="text-xl font-bold text-green-900">Customers</h2>
                    </div>
                    <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Balance</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {erpCustomers.length === 0 ? (
                                    <tr><td colSpan="5" className="px-4 py-8 text-center text-gray-500">No customers found</td></tr>
                                ) : (
                                    erpCustomers.slice(0, 100).map((c) => (
                                        <tr key={c.customerId || c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedItem(c); setShowDetailModal(true); }}>
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.customerName || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{c.email || '-'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{c.phone || '-'}</td>
                                            <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatCurrency(parseFloat(c.outstandingBalance) || 0)}</td>
                                            <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${c.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {/* Accidents */}
            {activeTab === 'accidents' && (
                <div className="bg-white rounded-2xl border overflow-hidden">
                    <div className="p-6 border-b bg-red-50">
                        <h2 className="text-xl font-bold text-red-900">Accidents</h2>
                    </div>
                    <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">RES</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Codes</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {erpAccidents.length === 0 ? (
                                    <tr><td colSpan="7" className="px-4 py-8 text-center text-gray-500">No accidents found</td></tr>
                                ) : (
                                    erpAccidents.slice(0, 100).map((a) => (
                                        <tr key={a.accidentId || a.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedItem(a); setShowDetailModal(true); }}>
                                            <td className="px-4 py-3 text-sm text-gray-900">{a.accidentDate?.substring(0, 10) || 'N/A')}</td>
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.vehiclePlate || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{a.customerName || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{a.resCode || '-'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{a.accidentCodes || '-'}</td>
                                            <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatCurrency(parseFloat(a.totalCost) || 0)}</td>
                                            <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${a.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{a.status || 'PENDING'}</span></td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {/* Protocols */}
            {activeTab === 'protocols' && (
                <div className="bg-white rounded-2xl border overflow-hidden">
                    <div className="p-6 border-b bg-purple-50">
                        <h2 className="text-xl font-bold text-purple-900">Protocols</h2>
                    </div>
                    <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Protocol #</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {erpProtocols.length === 0 ? (
                                    <tr><td colSpan="5" className="px-4 py-8 text-center text-gray-500">No protocols found</td></tr>
                                ) : (
                                    erpProtocols.slice(0, 100).map((p) => (
                                        <tr key={p.protocolId || p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedItem(p); setShowDetailModal(true); }}>
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.protocolNumber || p.id}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{p.vehiclePlate || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{p.customerName || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{p.createdAt?.substring(0, 10) || 'N/A'}</td>
                                            <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${p.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{p.status || 'PENDING'}</span></td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {/* Detail Modal */}
            {showDetailModal && selectedItem && (
                <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-gray-900">ERP Data Details</h2>
                            <button onClick={() => { setShowDetailModal(false); setSelectedItem(null); }}
                                    className="p-2 hover:bg-gray-100 rounded-xl transition-all">
                                <X size={24} className="text-gray-500" />
                            </button>
                        </div>
                        
                        <div className="space-y-6">
                            {Object.entries(selectedItem).map(([key, value]) => (
                                <div key={key} className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                                    <div className="w-32 text-sm font-medium text-gray-600 capitalize">
                                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:
                                    </div>
                                    <div className="flex-1 text-sm text-gray-900">
                                        {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || 'N/A')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Reports View - List format with detailed information
function ReportsView({ cars, returns, officeOperations }) {
    const [selectedReport, setSelectedReport] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);

    const reportTypes = [
        {
            id: 'vehicles',
            title: 'Vehicle Reports',
            description: 'Damage reports for all vehicles',
            count: cars.length,
            color: 'blue',
            icon: <Car size={24} />
        },
        {
            id: 'office',
            title: 'Office Operations',
            description: 'Financial operations and expenses',
            count: officeOperations.length,
            color: 'green',
            icon: <DollarSign size={24} />
        },
        {
            id: 'returns',
            title: 'Returns Report',
            description: 'Vehicle return records',
            count: returns.length,
            color: 'purple',
            icon: <ArrowLeft size={24} />
        }
    ];

    const handleReportClick = (reportType) => {
        setSelectedReport(reportType);
        setShowDetailModal(true);
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
                <p className="text-gray-600 mt-1">View detailed reports and analytics</p>
            </div>

            {/* Report Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {reportTypes.map((report) => (
                    <div key={report.id} 
                         onClick={() => handleReportClick(report)}
                         className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-lg transition-all cursor-pointer">
                        <div className="flex items-center gap-4 mb-4">
                            <div className={`w-12 h-12 bg-${report.color}-100 rounded-xl flex items-center justify-center`}>
                                <div className={`text-${report.color}-600`}>
                                    {report.icon}
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">{report.title}</h3>
                                <p className="text-sm text-gray-600">{report.description}</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-2xl font-bold text-gray-900">{report.count}</span>
                            <span className="text-sm text-gray-500">records</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Detail Modal */}
            {showDetailModal && selectedReport && (
                <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 w-full max-w-6xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-gray-900">{selectedReport.title}</h2>
                            <button onClick={() => { setShowDetailModal(false); setSelectedReport(null); }}
                                    className="p-2 hover:bg-gray-100 rounded-xl transition-all">
                                <X size={24} className="text-gray-500" />
                            </button>
                        </div>

                        {selectedReport.id === 'vehicles' && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {cars.map((car) => (
                                        <div key={car.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                            <div className="flex items-center gap-3 mb-3">
                                                <Car size={20} className="text-blue-600" />
                                                <h3 className="font-bold text-gray-900">{car.plaka}</h3>
                                            </div>
                                            <div className="space-y-2 text-sm">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Brand:</span>
                                                    <span className="font-medium">{car.marka}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Model:</span>
                                                    <span className="font-medium">{car.model}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Category:</span>
                                                    <span className="font-medium">{car.kategori}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Damages:</span>
                                                    <span className="font-medium">{car.hasarKayitlari?.length || 0}</span>
                                                </div>
                                            </div>
                                            {car.hasarKayitlari && car.hasarKayitlari.length > 0 && (
                                                <div className="mt-4">
                                                    <h4 className="text-sm font-medium text-gray-700 mb-2">Damage Records:</h4>
                                                    <div className="space-y-2">
                                                        {car.hasarKayitlari.map((hasar, index) => (
                                                            <div key={index} className="bg-white rounded-lg p-3 border border-gray-200">
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <span className="text-sm font-medium">{hasar.resKodu}</span>
                                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                                        hasar.durum === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                                                    }`}>
                                                                        {hasar.durum}
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-gray-600 space-y-1">
                                                                    <div>KM: {hasar.km}</div>
                                                                    <div>Date: {formatDate(hasar.tarih)}</div>
                                                                    {hasar.fotograflar && hasar.fotograflar.length > 0 && (
                                                                        <div className="flex items-center gap-1">
                                                                            <Camera size={12} />
                                                                            <span>{hasar.fotograflar.length} photos</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {selectedReport.id === 'office' && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <CreditCard size={20} className="text-blue-600" />
                                            <span className="font-medium text-blue-900">Credit Card</span>
                                        </div>
                                        <div className="text-2xl font-bold text-blue-900">
                                            {formatCurrency(officeOperations.filter(op => op.type === 'Credit Card Receipt').reduce((sum, op) => sum + (op.amount || 0), 0))}
                                        </div>
                                    </div>
                                    <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <DollarSign size={20} className="text-green-600" />
                                            <span className="font-medium text-green-900">POS Closing</span>
                                        </div>
                                        <div className="text-2xl font-bold text-green-900">
                                            {formatCurrency(officeOperations.filter(op => op.type === 'POS Daily Closing').reduce((sum, op) => sum + (op.amount || 0), 0))}
                                        </div>
                                    </div>
                                    <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Fuel size={20} className="text-orange-600" />
                                            <span className="font-medium text-orange-900">Fuel</span>
                                        </div>
                                        <div className="text-2xl font-bold text-orange-900">
                                            {formatCurrency(officeOperations.filter(op => op.type === 'Fuel Receipt').reduce((sum, op) => sum + (op.amount || 0), 0))}
                                        </div>
                                    </div>
                                    <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Droplet size={20} className="text-purple-600" />
                                            <span className="font-medium text-purple-900">Washing</span>
                                        </div>
                                        <div className="text-2xl font-bold text-purple-900">
                                            {formatCurrency(officeOperations.filter(op => op.type === 'Washing Expense').reduce((sum, op) => sum + (op.amount || 0), 0))}
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <div className="p-4 bg-gray-50 border-b">
                                        <h3 className="font-bold text-gray-900">Operation Details</h3>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                                {officeOperations.map((op, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-3 text-sm text-gray-900">{formatDate(op.date)}</td>
                                                        <td className="px-4 py-3 text-sm text-gray-900">{op.type}</td>
                                                        <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatCurrency(op.amount || 0)}</td>
                                                        <td className="px-4 py-3 text-sm text-gray-900">{op.description || 'N/A'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}

                        {selectedReport.id === 'returns' && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <ArrowLeft size={20} className="text-purple-600" />
                                            <span className="font-medium text-purple-900">Total Returns</span>
                                        </div>
                                        <div className="text-2xl font-bold text-purple-900">{returns.length}</div>
                                    </div>
                                    <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <DollarSign size={20} className="text-green-600" />
                                            <span className="font-medium text-green-900">Total Value</span>
                                        </div>
                                        <div className="text-2xl font-bold text-green-900">
                                            {formatCurrency(returns.reduce((sum, ret) => sum + (parseFloat(ret.tutar) || 0), 0))}
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <div className="p-4 bg-gray-50 border-b">
                                        <h3 className="font-bold text-gray-900">Return Details</h3>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                                {returns.map((ret, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{ret.aracPlaka}</td>
                                                        <td className="px-4 py-3 text-sm text-gray-900">{formatDate(ret.iadeTarihi)}</td>
                                                        <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatCurrency(parseFloat(ret.tutar) || 0)}</td>
                                                        <td className="px-4 py-3 text-sm text-gray-900">{ret.notlar || 'N/A'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// Add other components here (CarsView, ReturnsView, etc.) - keeping the file manageable
// For now, I'll add placeholder components

function CarsView({ cars, onRefresh, addActivity }) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Vehicles</h1>
                <p className="text-gray-600 mt-1">Manage your vehicle fleet</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <p className="text-gray-600">Vehicle management interface will be implemented here.</p>
            </div>
        </div>
    );
}

function ReturnsView({ returns, cars, onRefresh, addActivity }) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Returns</h1>
                <p className="text-gray-600 mt-1">Manage vehicle returns</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <p className="text-gray-600">Returns management interface will be implemented here.</p>
            </div>
        </div>
    );
}

function ServiceView({ services, cars, serviceFirms, onRefresh, addActivity }) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Service Records</h1>
                <p className="text-gray-600 mt-1">Manage service records</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <p className="text-gray-600">Service management interface will be implemented here.</p>
            </div>
        </div>
    );
}

function ServiceFirmsView({ firms, onRefresh, addActivity }) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Service Firms</h1>
                <p className="text-gray-600 mt-1">Manage service firms</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <p className="text-gray-600">Service firms management interface will be implemented here.</p>
            </div>
        </div>
    );
}

function OfficeOperationsView({ operations, cars, onRefresh, addActivity }) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Office Operations</h1>
                <p className="text-gray-600 mt-1">Manage office operations</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <p className="text-gray-600">Office operations management interface will be implemented here.</p>
            </div>
        </div>
    );
}

function AnalyticsView({ cars, services, returns, officeOperations, activities }) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
                <p className="text-gray-600 mt-1">View analytics and statistics</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <p className="text-gray-600">Analytics interface will be implemented here.</p>
            </div>
        </div>
    );
}

export default App;
