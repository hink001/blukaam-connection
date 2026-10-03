const mongoose = require('mongoose');

const GeneralDataSchema = new mongoose.Schema({
    // Using mongoose.Schema.Types.Mixed allows any arbitrary structure or properties
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    // Adding optional metadata for better querying
    typeOfData: {
        type: String,
        description: 'Optional label to categorize this unstructured data'
    }
}, {
    timestamps: true,
    strict: false // strict: false allows saving fields not defined in the schema
});

module.exports = mongoose.model('GeneralData', GeneralDataSchema);
