pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract RealEstateCipher is ZamaEthereumConfig {
    struct Property {
        string encryptedOwner;          
        euint32 encryptedPrice;         
        uint256 publicArea;             
        uint256 publicYearBuilt;        
        string encryptedLocation;       
        address lister;                 
        uint256 timestamp;              
        uint32 decryptedPrice;          
        bool isVerified;                
    }

    mapping(string => Property) public properties;
    string[] public propertyIds;

    event PropertyListed(string indexed propertyId, address indexed lister);
    event PriceDecrypted(string indexed propertyId, uint32 decryptedPrice);

    constructor() ZamaEthereumConfig() {
    }

    function listProperty(
        string calldata propertyId,
        string calldata encryptedOwner,
        externalEuint32 encryptedPrice,
        bytes calldata priceProof,
        uint256 publicArea,
        uint256 publicYearBuilt,
        string calldata encryptedLocation
    ) external {
        require(bytes(properties[propertyId].encryptedOwner).length == 0, "Property already listed");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPrice, priceProof)), "Invalid encrypted price");

        properties[propertyId] = Property({
            encryptedOwner: encryptedOwner,
            encryptedPrice: FHE.fromExternal(encryptedPrice, priceProof),
            publicArea: publicArea,
            publicYearBuilt: publicYearBuilt,
            encryptedLocation: encryptedLocation,
            lister: msg.sender,
            timestamp: block.timestamp,
            decryptedPrice: 0,
            isVerified: false
        });

        FHE.allowThis(properties[propertyId].encryptedPrice);
        FHE.makePubliclyDecryptable(properties[propertyId].encryptedPrice);

        propertyIds.push(propertyId);
        emit PropertyListed(propertyId, msg.sender);
    }

    function verifyPriceDecryption(
        string calldata propertyId,
        bytes memory abiEncodedClearPrice,
        bytes memory decryptionProof
    ) external {
        require(bytes(properties[propertyId].encryptedOwner).length > 0, "Property not found");
        require(!properties[propertyId].isVerified, "Price already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(properties[propertyId].encryptedPrice);

        FHE.checkSignatures(cts, abiEncodedClearPrice, decryptionProof);

        uint32 decodedPrice = abi.decode(abiEncodedClearPrice, (uint32));
        properties[propertyId].decryptedPrice = decodedPrice;
        properties[propertyId].isVerified = true;

        emit PriceDecrypted(propertyId, decodedPrice);
    }

    function getEncryptedPrice(string calldata propertyId) external view returns (euint32) {
        require(bytes(properties[propertyId].encryptedOwner).length > 0, "Property not found");
        return properties[propertyId].encryptedPrice;
    }

    function getPropertyDetails(string calldata propertyId) external view returns (
        string memory encryptedOwner,
        uint256 publicArea,
        uint256 publicYearBuilt,
        string memory encryptedLocation,
        address lister,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedPrice
    ) {
        require(bytes(properties[propertyId].encryptedOwner).length > 0, "Property not found");
        Property storage p = properties[propertyId];

        return (
            p.encryptedOwner,
            p.publicArea,
            p.publicYearBuilt,
            p.encryptedLocation,
            p.lister,
            p.timestamp,
            p.isVerified,
            p.decryptedPrice
        );
    }

    function getAllPropertyIds() external view returns (string[] memory) {
        return propertyIds;
    }

    function isOperational() public pure returns (bool) {
        return true;
    }
}


