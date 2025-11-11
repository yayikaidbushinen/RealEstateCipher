import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface RealEstateData {
  id: string;
  name: string;
  location: string;
  encryptedValue: string;
  publicArea: number;
  publicRooms: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<RealEstateData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProperty, setCreatingProperty] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPropertyData, setNewPropertyData] = useState({ 
    name: "", 
    location: "", 
    price: "", 
    area: "", 
    rooms: "", 
    description: "" 
  });
  const [selectedProperty, setSelectedProperty] = useState<RealEstateData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM for real estate tokenization...');
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadProperties();
      } catch (error) {
        console.error('Failed to load properties:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadProperties = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const propertiesList: RealEstateData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          propertiesList.push({
            id: businessId,
            name: businessData.name,
            location: businessId,
            encryptedValue: businessId,
            publicArea: Number(businessData.publicValue1) || 0,
            publicRooms: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading property data:', e);
        }
      }
      
      setProperties(propertiesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load properties" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createProperty = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingProperty(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating property with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const priceValue = parseInt(newPropertyData.price) || 0;
      const businessId = `property-${Date.now()}`;
      
      const contractAddress = await contract.getAddress();
      const encryptedResult = await encrypt(contractAddress, address, priceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPropertyData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newPropertyData.area) || 0,
        parseInt(newPropertyData.rooms) || 0,
        newPropertyData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      addUserHistory('CREATE', businessId, newPropertyData.name);
      
      setTransactionStatus({ visible: true, status: "success", message: "Property tokenized successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadProperties();
      setShowCreateModal(false);
      setNewPropertyData({ name: "", location: "", price: "", area: "", rooms: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProperty(false); 
    }
  };

  const decryptProperty = async (propertyId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const propertyData = await contractRead.getBusinessData(propertyId);
      if (propertyData.isVerified) {
        const storedValue = Number(propertyData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Price already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        addUserHistory('VERIFY', propertyId, propertyData.name);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(propertyId);
      const contractAddress = await contractWrite.getAddress();
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(propertyId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying price decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadProperties();
      addUserHistory('VERIFY', propertyId, propertyData.name);
      
      setTransactionStatus({ visible: true, status: "success", message: "Price decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Price already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadProperties();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const addUserHistory = (action: string, propertyId: string, propertyName: string) => {
    const historyEntry = {
      action,
      propertyId,
      propertyName,
      timestamp: Date.now(),
      user: address
    };
    setUserHistory(prev => [historyEntry, ...prev.slice(0, 9)]);
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredProperties = properties.filter(property =>
    property.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedProperties = filteredProperties.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredProperties.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🏢</div>
            <h1>RealEstateCipher</h1>
            <span className="tagline">Private Real Estate Tokenization</span>
          </div>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </header>
        
        <div className="hero-section">
          <div className="hero-content">
            <h2>Privacy-First Real Estate Tokenization</h2>
            <p>Tokenize your real estate assets with fully encrypted ownership and transaction data using FHE technology</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🔐</div>
                <h3>Encrypted Ownership</h3>
                <p>Property ownership details remain confidential with FHE encryption</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">💸</div>
                <h3>Private Transactions</h3>
                <p>Trade real estate tokens without revealing transaction prices</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🏘️</div>
                <h3>Fractional Ownership</h3>
                <p>Support for fractional real estate investment with privacy protection</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your real estate data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted properties...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">🏢</div>
          <div>
            <h1>RealEstateCipher</h1>
            <span className="tagline">FHE Protected Real Estate</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button className="action-btn" onClick={callIsAvailable}>
            Check Availability
          </button>
          <button className="action-btn" onClick={() => setShowHistory(!showHistory)}>
            History ({userHistory.length})
          </button>
          <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
            + Tokenize Property
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-content">
        <div className="stats-section">
          <div className="stat-card">
            <h3>Total Properties</h3>
            <div className="stat-value">{properties.length}</div>
          </div>
          <div className="stat-card">
            <h3>Verified Prices</h3>
            <div className="stat-value">{properties.filter(p => p.isVerified).length}</div>
          </div>
          <div className="stat-card">
            <h3>FHE Protected</h3>
            <div className="stat-value">{properties.length}</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search properties..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="search-icon">🔍</span>
          </div>
          <button onClick={loadProperties} className="refresh-btn">
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="properties-grid">
          {paginatedProperties.map((property, index) => (
            <div key={index} className="property-card">
              <div className="property-header">
                <h3>{property.name}</h3>
                <span className={`status-badge ${property.isVerified ? 'verified' : 'pending'}`}>
                  {property.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                </span>
              </div>
              
              <div className="property-details">
                <div className="detail-item">
                  <span>Area:</span>
                  <strong>{property.publicArea} sqft</strong>
                </div>
                <div className="detail-item">
                  <span>Rooms:</span>
                  <strong>{property.publicRooms}</strong>
                </div>
                <div className="detail-item">
                  <span>Price:</span>
                  <strong>
                    {property.isVerified ? 
                      `$${property.decryptedValue}K` : 
                      '🔒 FHE Encrypted'
                    }
                  </strong>
                </div>
              </div>

              <p className="property-desc">{property.description}</p>

              <div className="property-actions">
                <button 
                  onClick={() => decryptProperty(property.id)}
                  className={`decrypt-btn ${property.isVerified ? 'verified' : ''}`}
                >
                  {property.isVerified ? 'Price Verified' : 'Decrypt Price'}
                </button>
                <button onClick={() => setSelectedProperty(property)} className="details-btn">
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredProperties.length > itemsPerPage && (
          <div className="pagination">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}

        {showHistory && userHistory.length > 0 && (
          <div className="history-panel">
            <h3>Your Activity History</h3>
            <div className="history-list">
              {userHistory.map((entry, index) => (
                <div key={index} className="history-item">
                  <span className={`action-type ${entry.action.toLowerCase()}`}>
                    {entry.action}
                  </span>
                  <span className="property-name">{entry.propertyName}</span>
                  <span className="timestamp">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreatePropertyModal
          onSubmit={createProperty}
          onClose={() => setShowCreateModal(false)}
          creating={creatingProperty}
          propertyData={newPropertyData}
          setPropertyData={setNewPropertyData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedProperty && (
        <PropertyDetailModal
          property={selectedProperty}
          onClose={() => setSelectedProperty(null)}
          onDecrypt={() => decryptProperty(selectedProperty.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const CreatePropertyModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  propertyData: any;
  setPropertyData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, propertyData, setPropertyData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'price' || name === 'area' || name === 'rooms') {
      const intValue = value.replace(/[^\d]/g, '');
      setPropertyData({ ...propertyData, [name]: intValue });
    } else {
      setPropertyData({ ...propertyData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Tokenize New Property</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encryption Active</strong>
              <p>Property price will be encrypted using Zama FHE technology</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Property Name *</label>
              <input
                type="text"
                name="name"
                value={propertyData.name}
                onChange={handleChange}
                placeholder="Luxury Villa..."
              />
            </div>

            <div className="form-group">
              <label>Location *</label>
              <input
                type="text"
                name="location"
                value={propertyData.location}
                onChange={handleChange}
                placeholder="New York, NY"
              />
            </div>

            <div className="form-group">
              <label>Price (USD) * - FHE Encrypted</label>
              <input
                type="number"
                name="price"
                value={propertyData.price}
                onChange={handleChange}
                placeholder="1000000"
              />
              <span className="input-hint">Integer only - Will be encrypted</span>
            </div>

            <div className="form-group">
              <label>Area (sqft) *</label>
              <input
                type="number"
                name="area"
                value={propertyData.area}
                onChange={handleChange}
                placeholder="2500"
              />
              <span className="input-hint">Public information</span>
            </div>

            <div className="form-group">
              <label>Rooms *</label>
              <input
                type="number"
                name="rooms"
                value={propertyData.rooms}
                onChange={handleChange}
                placeholder="4"
              />
              <span className="input-hint">Public information</span>
            </div>
          </div>

          <div className="form-group full-width">
            <label>Description</label>
            <textarea
              name="description"
              value={propertyData.description}
              onChange={handleChange}
              placeholder="Describe the property features..."
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !propertyData.name || !propertyData.price}
            className="primary-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Tokenize Property"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PropertyDetailModal: React.FC<{
  property: RealEstateData;
  onClose: () => void;
  onDecrypt: () => void;
  isDecrypting: boolean;
}> = ({ property, onClose, onDecrypt, isDecrypting }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-content large">
        <div className="modal-header">
          <h2>{property.name}</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="property-info-grid">
            <div className="info-section">
              <h3>Property Details</h3>
              <div className="info-item">
                <span>Location:</span>
                <strong>{property.location}</strong>
              </div>
              <div className="info-item">
                <span>Area:</span>
                <strong>{property.publicArea} sqft</strong>
              </div>
              <div className="info-item">
                <span>Rooms:</span>
                <strong>{property.publicRooms}</strong>
              </div>
              <div className="info-item">
                <span>Tokenized:</span>
                <strong>{new Date(property.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
            </div>

            <div className="info-section">
              <h3>Price Information</h3>
              <div className="price-display">
                <div className={`price-value ${property.isVerified ? 'verified' : 'encrypted'}`}>
                  {property.isVerified ? 
                    `$${property.decryptedValue}K` : 
                    '🔒 Encrypted'
                  }
                </div>
                <div className="price-status">
                  {property.isVerified ? 'On-chain Verified' : 'FHE Protected'}
                </div>
              </div>
              
              <button 
                onClick={onDecrypt}
                disabled={isDecrypting}
                className={`decrypt-btn large ${property.isVerified ? 'verified' : ''}`}
              >
                {isDecrypting ? 'Decrypting...' : 
                 property.isVerified ? 'Price Verified' : 'Decrypt Price'}
              </button>
            </div>
          </div>

          <div className="description-section">
            <h3>Description</h3>
            <p>{property.description}</p>
          </div>

          <div className="fhe-explanation">
            <h3>🔐 FHE Protection</h3>
            <p>This property's price is encrypted using Fully Homomorphic Encryption. 
               The actual transaction value remains confidential while allowing verification.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;


